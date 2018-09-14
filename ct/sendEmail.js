var contextValues = {
  alreadyDeleted: {},
};
var fetchPayload = {
};
var urls = {
};

// Get login cookie
function login() {
  var postOptions = {
    method: 'post',
    payload: {
      email: fetchPayload.email,
      password: sjcl.decrypt(fetchPayload.salt, fetchPayload.password),
    },
    followRedirects: false,
  };
  var loginPage = UrlFetchApp.fetch(urls.login, postOptions);
  var loginCode = loginPage.getResponseCode();
  if (loginCode === 200) { //could not log in.
    return "Couldn't login. Please make sure your username/password is correct.";
  } else if (loginCode === 303 || loginCode === 302) {
    return loginPage.getAllHeaders()['Set-Cookie'];
  }
}

// Get the main page
function getMainPageCT() {
  if (!fetchPayload.cookie) {
    fetchPayload.cookie = login();
  }

  var mainPage = UrlFetchApp.fetch(urls.main,
                                  {
                                    headers: {
                                      Cookie: fetchPayload.cookie,
                                    },
                                  });
  return mainPage.getContentText();
}

// Main function for each sheet
// Add to arrays for emailing out later
var updatedItems = [];
var newItemsForUpdate = [];
function updateSheet() {
  // Only run after 8 AM or before 10 PM
  var currentDate = new Date();
  var currentHour = currentDate.getHours();
  if (currentHour <= 8 || currentHour >= 22) {
    return;
  }

  contextValues.sheet = SpreadsheetApp.getActiveSpreadsheet()
                                      .getSheetByName('Current');
  contextValues.sheetData = contextValues.sheet.getDataRange().getValues();
  contextValues.sheetIndex = indexSheet(contextValues.sheetData);
  processPreviousListings();

/** NOT WORKING
  // Process FM Listings
  var fmHTML = UrlFetchApp.fetch(urls.fmMain,
                                  {
                                    headers : {
                                      Cookie: fetchPayload.fmCookie,
                                    },
                                  });
  var fmPage = cleanupHTML(fmHTML.getContentText());
  var errorMessage = 'You do not have the required permissions to read topics within this forum';
  if (fmPage.indexOf(errorMessage) === -1) {
    var fmDoc = Xml.parse(fmPage, true).getElement();
    var fmList = getElementsByTagName(fmDoc, 'table');
    var fmItems = getElementsByTagName(fmList[5], 'tr');
    fmItems.forEach(addOrUpdateFm);
  } else {
    removeAndEmail(urls.fmDomain);
    return;
  }
**/

  // Log in to AC
  var loginSfPage = UrlFetchApp.fetch(urls.sfLogin, {
      method: 'post',
      followRedirects: false,
      payload: {
        email_address: fetchPayload.email_address,
        password: sjcl.decrypt(fetchPayload.salt, fetchPayload.sfPassword),
      },
    });
  var loginSfCode = loginSfPage.getResponseCode();
  var sfHeaders = loginSfPage.getAllHeaders();
  if (loginSfCode === 200) { //could not log in.
    removeAndEmail(urls.sf);
  } else if (loginSfCode === 303 || loginSfCode === 302) {
    fetchPayload.sfCookie = sfHeaders['Set-Cookie'];
    // Process AC Listings
    var sfHTML = UrlFetchApp.fetch(urls.sfMain,
                                    {
                                      headers: {
                                        Cookie: fetchPayload.sfCookie,
                                      },
                                    });
    var sfPage = cleanupHTML(sfHTML.getContentText());
    var sfDoc = Xml.parse(sfPage, true).getElement();
    getElementByClassName(sfDoc, 'showcasebox').forEach(addOrUpdateSf);
  }

  // Process AC Listings
  // First, figure out which ones are free
  var acFreeHTML = UrlFetchApp.fetch(urls.acFree,
                                  {
                                    headers: {
                                      Cookie: fetchPayload.acCookie,
                                    },
                                  });
  var acFreePage = cleanupHTML(acFreeHTML.getContentText());
  var acError = 'Login';

  // Then, go through existing listings and update them
  if (acFreePage.indexOf(acError) === -1) {
    contextValues.freeAC = {};

    var acFreeDoc = Xml.parse(acFreePage, true).getElement();
    var acFreeItem = getElementByClassName(acFreeDoc, 'rushticketpane');
    if (acFreeItem && acFreeItem.length) {
      acFreeItem.forEach(processFreeItems);
    }

    var acHTML = UrlFetchApp.fetch(urls.acMain,
                                    {
                                      headers: {
                                        Cookie: fetchPayload.acCookie,
                                      },
                                    });
    var acPage = cleanupHTML(acHTML.getContentText());

    var acDoc = Xml.parse(acPage, true).getElement();
    var acTable = getElementByClassName(acDoc, 'page_content')[0];
    var acItems = getElementByClassName(acTable, 'ladderrung');
    acItems.forEach(addOrUpdateAc);
  } else {
    removeAndEmail(urls.acDomain);
  }

  // Process CT Listings
  var mainPage = cleanupHTML(getMainPageCT());
  var doc = Xml.parse(mainPage, true).getElement();
  var mainList = getElementsByTagName(doc, 'ul');
  var items = getElementsByTagName(mainList[3], 'li');
  items.forEach(addOrUpdate);

  // Process OTL listings
  var otlHTML = UrlFetchApp.fetch(urls.otlMain,
                                  {
                                    headers : {
                                      Cookie: fetchPayload.otlCookie,
                                    },
                                  });
  var otlPage = cleanupHTML(otlHTML.getContentText());

  var otlError = 'On the List (OTL) Seat Filler Memberships';
  if (otlPage.indexOf(otlError) === -1) {
    var otlDoc = Xml.parse(otlPage, true).getElement();
    var otlTable = getElementsByTagName(otlDoc, 'table')[0];
    var otlItems = getElementsByTagName(otlTable, 'tr');
    otlItems.forEach(addOrUpdateOtl);
  } else {
    removeAndEmail(urls.otlDomain);
  }

  updateCellRow();
  sendEmail();
  archiveExpiredItems();
}

function cleanupHTML(htmlText) {
  return htmlText.match(/<body[\s\S]*?<\/body>/)[0]
                 .replace(/<(no)?script[\s\S]*?<\/(no)?script>/g, '')
                 .replace(/<!--|-->/g, '');
}

// Process previous data, including title and fee in case those change
function processPreviousListings() {
  var titleIdx = contextValues.sheetIndex.Title;
  var idIdx = contextValues.sheetIndex.Url;
  var feeIdx = contextValues.sheetIndex.AdminFee;
  var imageIdx = contextValues.sheetIndex.Image;
  var dateIdx = contextValues.sheetIndex.Date;
  contextValues.lastRow = numberOfRows(contextValues.sheetData, titleIdx);
  contextValues.previousListings = {};

  // Also, get formula for image
  // Get range by row, column, row length, column length
  var cells = contextValues.sheet.getRange(1, imageIdx + 1, contextValues.lastRow);
  var imageFormulas = cells.getFormulas();
  var previousListingObject = {};
  var urlValue, titleValue, feeValue, dateValue;
  for (var i = 1; i < contextValues.lastRow; i++) {
    urlValue = contextValues.sheetData[i][idIdx].trim();
    titleValue = contextValues.sheetData[i][titleIdx];
    feeValue = contextValues.sheetData[i][feeIdx];
    dateValue = contextValues.sheetData[i][dateIdx];
    contextValues.sheetData[i][imageIdx] = imageFormulas[i][0];
    previousListingObject = {
      row: i,
      title: titleValue,
      fee: feeValue,
      date: dateValue,
    };
    previousListingObject[titleIdx] = titleValue;
    previousListingObject[feeIdx] = feeValue;
    previousListingObject[idIdx] = urlValue;
    previousListingObject[dateIdx] = dateValue;
    contextValues.previousListings[urlValue] = previousListingObject;
  }
}

function removeAndEmail(domain) {
  for (var oldUrl in contextValues.previousListings) {
    if (contextValues.previousListings.hasOwnProperty(oldUrl) && oldUrl.indexOf(domain) !== -1) {
      delete contextValues.previousListings[oldUrl];
    }
  }

  // Only send it once by storing on "Errors" sheet
  if (!contextValues.errorSheet) {
    contextValues.errorSheet = SpreadsheetApp.getActiveSpreadsheet()
                                             .getSheetByName('Errors');
    contextValues.errorData = contextValues.errorSheet.getDataRange().getValues();
    contextValues.errorIndex = indexSheet(contextValues.errorData);
    contextValues.lastErrorRow = numberOfRows(contextValues.errorData);
    contextValues.errorDateIdx = contextValues.errorIndex.Date;
    contextValues.errorSitesIdx = contextValues.errorIndex.Sites;
  }

  // If it hasn't been emailed today
  var lastEmailedDate = contextValues.errorData[contextValues.lastErrorRow - 1][contextValues.errorDateIdx];
  if (!lastEmailedDate.toDateString || lastEmailedDate.toDateString() !== new Date().toDateString()) {
    var updateMessage = 'Update ' + domain + ' Token';
    var email = MailApp.sendEmail({
      to: myEmail,
      subject: '[CT] ' + updateMessage,
      htmlBody: updateMessage
                 + ': https://docs.google.com/spreadsheets/d/1AC4XDCtUaCaG7O21w1GpJS59Vxt4QmTBypIjKhBR3TU/edit#gid=0',
    });

    contextValues.lastErrorRow++;
  }

  // Add current page to list of pages needing update
  if (!contextValues.errorData[contextValues.lastErrorRow - 1]) {
    contextValues.errorData[contextValues.lastErrorRow - 1] = [];
  }

  var currentData = contextValues.errorData[contextValues.lastErrorRow - 1][contextValues.errorSitesIdx];
  if (!currentData || currentData.indexOf(domain) === -1) {
    var cells = contextValues.errorSheet.getRange(contextValues.lastErrorRow, 1, 1, 2);
    currentData = currentData ? currentData + ', ' + domain : domain;
    cells.setValues([[new Date(), currentData]]);
  }
}

// Figure out of the page which listings are new
var hasPassedTopic;
function addOrUpdateFm(item) {
  var htmlText = item.toXmlString();
  if (!hasPassedTopic) {
    hasPassedTopic = htmlText.indexOf('Topics') !== -1;
    return;
  }

  var links = getElementsByTagName(item, 'a')
  var aElement = links[0];
  var url = aElement.getAttribute('href').getValue().replace('.', urls.fmDomain).trim();
  var itemInfo = contextValues.previousListings[url];
  if (itemInfo) {
    delete contextValues.previousListings[url];
    contextValues.alreadyDeleted[url] = true;
  } else if (!contextValues.alreadyDeleted[url]) {
    var listingInfo = [];
    listingInfo[contextValues.sheetIndex.Image] = '=Image("' + urls.fmImage + '")';
    listingInfo[contextValues.sheetIndex.Title] = aElement.getText().trim();
    listingInfo[contextValues.sheetIndex.AdminFee] = 0;
    listingInfo[contextValues.sheetIndex.Date] = trimHeader(mainInfo[0].getText());
    listingInfo[contextValues.sheetIndex.Category] = 'Movie';
    listingInfo[contextValues.sheetIndex.Location] = aElement.getAttribute('title').getValue();
    listingInfo[contextValues.sheetIndex.Url] = url;
    listingInfo[contextValues.sheetIndex.EventManager] = links[1].getText().trim();
    listingInfo[contextValues.sheetIndex.UploadDate] = new Date();
    newItemsForUpdate.push(listingInfo);
  }
}


// Figure out of the page which listings are new
function addOrUpdateSf(item) {
  var aElement = getElementsByTagName(item, 'a')[0];
  var url = aElement.getAttribute('href').getValue().trim();
  var itemInfo = contextValues.previousListings[url];
  if (itemInfo) {
    delete contextValues.previousListings[url];
    contextValues.alreadyDeleted[url] = true;
  } else if (!contextValues.alreadyDeleted[url]) {
    var itemHtml = item.toXmlString();
    var ImageUrl = itemHtml.match(/background-image:url\(&quot;(http:\/\/.*?\.jpg)/i);
    var title = getElementsByTagName(item, 'h2');
    var date = getElementByClassName(item, 'date-event');
    var description = getElementByClassName(item, 'internal_content');

    var detailPage = cleanupHTML(UrlFetchApp.fetch(url).getContentText());
    var detailError = 'Sorry, this offer has now ended';
    var price = '', location = '', time = '';
    if (detailPage.indexOf(detailError) === -1) {
      price = detailPage.match(/price_info_box.*?>([\s\S]*?)<\/span>/);
      location = detailPage.match(/location_td.*?>([\s\S]*?)<\/td>/);
      price = price ? trimHtml(price[1]) : '';
      location = location ? trimHtml(location[1]) : '';
      time = ' @ ' + detailPage.match(/<td>(.*?:.*?)<\/td>/)[1];
    }

    var listingInfo = [];
    listingInfo[contextValues.sheetIndex.Image] = '=Image("' + ImageUrl[1] + '")';
    listingInfo[contextValues.sheetIndex.Title] = title[0].getText().trim();
    listingInfo[contextValues.sheetIndex.AdminFee] = price;
    listingInfo[contextValues.sheetIndex.Date] = date[0].getText().trim() + time;
    listingInfo[contextValues.sheetIndex.Category] = trimHtml(description[0].toXmlString());
    listingInfo[contextValues.sheetIndex.Location] = location;
    listingInfo[contextValues.sheetIndex.Url] = url;
    listingInfo[contextValues.sheetIndex.EventManager] = '';
    listingInfo[contextValues.sheetIndex.UploadDate] = new Date();
    newItemsForUpdate.push(listingInfo);
  }
}

function getACUrl(urlEnd) {
  return urls.acDomain + 'member/' + urlEnd.replace(/&return=.*$/, '').trim();
}

function processFreeItems(item) {
  var freeUrl = getElementsByTagName(item, 'a')[0].getAttribute('href').getValue();
  contextValues.freeAC[getACUrl(freeUrl)] = true;
}

// Figure out of the page which listings are new
function addOrUpdateAc(item) {
  var header = getElementByClassName(item, 'showtitle')
  var aElement = getElementsByTagName(header[0], 'a')[0];
  var title = aElement.getText().trim();
  var url = getACUrl(aElement.getAttribute('href').getValue());
  var itemInfo = contextValues.previousListings[url];
  var currentItem = [];
  if (itemInfo) {
    var isNowFree = contextValues.freeAC[url] && itemInfo[contextValues.sheetIndex.AdminFee] !== 'FREE';
    var isNowPaid = !contextValues.freeAC[url] && itemInfo[contextValues.sheetIndex.AdminFee] === 'FREE';
    if (isNowFree || isNowPaid) {
      var newFee = isNowFree ? 'FREE' : '~£3.60';
      var oldFee = isNowFree ? '~£3.60' : 'FREE';
      updateCell(itemInfo.row + 1, 'AdminFee', newFee);
      currentItem[contextValues.sheetIndex.AdminFee] = newFee + ' <br><em>(Previously ' + oldFee + ')</em>';
      currentItem[contextValues.sheetIndex.Title] = title;
      currentItem[contextValues.sheetIndex.Url] = url;
      updatedItems.push(currentItem);
    }

    delete contextValues.previousListings[url];
    contextValues.alreadyDeleted[url] = true;
  } else if (!contextValues.alreadyDeleted[url]) {
    var ImageElements = getElementByClassName(item, 'pic');
    var ImageUrl = ImageElements[1] ? urls.acDomain + ImageElements[1].getAttribute('src').getValue() : '';
    var date = getElementByClassName(item, 'dateTime')[0]
                .getText()
                .replace('Check dates and availability...', '')
                .trim();

    var venue = getElementByClassName(item, 'venue');
    venue = trimHtml(venue[0].toXmlString()).trim();
    var description = getElementByClassName(item, 'showdescription')[0].getText().trim();

    var listingInfo = [];
    listingInfo[contextValues.sheetIndex.Image] = '=Image("' + ImageUrl + '")';
    listingInfo[contextValues.sheetIndex.Title] = title;
    listingInfo[contextValues.sheetIndex.AdminFee] = contextValues.freeAC[url] ? 'FREE' : '~£3.60';
    listingInfo[contextValues.sheetIndex.Date] = date;
    listingInfo[contextValues.sheetIndex.Category] = description;
    listingInfo[contextValues.sheetIndex.Location] = venue;
    listingInfo[contextValues.sheetIndex.Url] = url;
    listingInfo[contextValues.sheetIndex.EventManager] = '';
    listingInfo[contextValues.sheetIndex.UploadDate] = new Date();
    newItemsForUpdate.push(listingInfo);
  }
}

// Figure out of the page which listings are new
function addOrUpdateOtl(item) {
  var className = item.getAttribute('class');
  if (className && className.getValue().indexOf('event-row') === -1) {
    return;
  }

  var links = getElementsByTagName(item, 'a')
  if (!links.length) {
    return;
  }

  var aElement = links[1] || links[0];
  var url = aElement.getAttribute('href').getValue().trim();
  var itemInfo = contextValues.previousListings[url];
  if (itemInfo) {
    delete contextValues.previousListings[url];
    contextValues.alreadyDeleted[url] = true;
  } else if (!contextValues.alreadyDeleted[url]) {
    var htmlText = item.toXmlString();
    var ImageElements = getElementsByTagName(item, 'img');
    var ImageUrl = ImageElements[1].getAttribute('src').getValue();
    if (!ImageUrl && ImageElements[0]) {
      ImageUrl = ImageElements[0].getAttribute('src').getValue();
    }
    var paragraphs = getElementsByTagName(item, 'p');
    var mainInfo = getElementsByTagName(paragraphs[0], 'span');

    var listingInfo = [];
    listingInfo[contextValues.sheetIndex.Image] = '=Image("' + ImageUrl + '")';
    listingInfo[contextValues.sheetIndex.Title] = aElement.getText().trim();
    listingInfo[contextValues.sheetIndex.AdminFee] = trimHeader(mainInfo[2].getText());
    listingInfo[contextValues.sheetIndex.Date] = trimHeader(mainInfo[0].getText());
    listingInfo[contextValues.sheetIndex.Category] = paragraphs[1].getText().trim() || '';
    listingInfo[contextValues.sheetIndex.Location] = trimHeader(mainInfo[1].getText());
    listingInfo[contextValues.sheetIndex.Url] = url;
    listingInfo[contextValues.sheetIndex.EventManager] = '';
    listingInfo[contextValues.sheetIndex.UploadDate] = new Date();
    newItemsForUpdate.push(listingInfo);
  }
}


function addOrUpdate(item) {
  // Get href
  var aElement = getElementsByTagName(item, 'a')[0];
  var url = aElement.getAttribute('href').getValue().trim();
  var itemInfo = contextValues.previousListings[url];
  var htmlText = item.toXmlString();
  if (itemInfo) {
    // see if there's anything to update, if not, then just delete
    var title = getTitle(item),
        fee = getFee(htmlText),
        date = getDate(htmlText),
        currentItem = [];
    if (fee !== itemInfo.fee) {
      updateCell(itemInfo.row + 1, 'AdminFee', fee);
      currentItem[contextValues.sheetIndex.AdminFee] = fee + '<br><em>(Previously ' + itemInfo.fee + ')</em>';
    }

    if (date !== itemInfo.date) {
      updateCell(itemInfo.row + 1, 'Date', date);
      currentItem[contextValues.sheetIndex.Date] = date + '<br><em>(Previously ' + itemInfo.date + ')</em>';
    }

    if (title !== itemInfo.title) {
      updateCell(itemInfo.row + 1, 'Title', title);
      currentItem[contextValues.sheetIndex.Title] = title + '<br><em>(Previously ' + itemInfo.title + ')</em>';
    }

    if (currentItem.length) {
      if (!currentItem[contextValues.sheetIndex.Title]) {
        currentItem[contextValues.sheetIndex.Title] = title;
      }

      currentItem[contextValues.sheetIndex.Url] = url;
      updatedItems.push(currentItem);
    }

    delete contextValues.previousListings[url];
    contextValues.alreadyDeleted[url] = true;
  } else if (!contextValues.alreadyDeleted[url]) {
    addNewListing(item, htmlText, url);
  }
}

// Get listing full page
function addNewListing(item, htmlText, url) {
  var ImageUrl = getElementsByTagName(item, 'img')[0].getAttribute('src').getValue();
  var listingInfo = [];
  listingInfo[contextValues.sheetIndex.Image] = '=Image("' + ImageUrl + '")';
  listingInfo[contextValues.sheetIndex.Title] = getTitle(item);
  listingInfo[contextValues.sheetIndex.AdminFee] = getFee(htmlText);
  listingInfo[contextValues.sheetIndex.Date] = getDate(htmlText);
  listingInfo[contextValues.sheetIndex.Category] = getColonSeparatedText(htmlText, 'Category');
  listingInfo[contextValues.sheetIndex.Location] = getColonSeparatedText(htmlText, 'Location');
  listingInfo[contextValues.sheetIndex.Url] = url;
  listingInfo[contextValues.sheetIndex.EventManager] = getColonSeparatedText(htmlText, 'Event Manager');
  listingInfo[contextValues.sheetIndex.UploadDate] = new Date();
  newItemsForUpdate.push(listingInfo);
}

// Parse with text
function getTitle(item) {
  return getElementsByTagName(getElementsByTagName(item, 'h4')[0], 'a')[0].getText().trim();
}

function getFee(htmlText) {
  return getColonSeparatedText(htmlText, 'Admin Fee');
}

function getDate(htmlText) {
  return getColonSeparatedText(htmlText, 'Event Date');
}

function getColonSeparatedText(text, expression) {
  var regexExpr = new RegExp(expression + '\\s*:[\\s\\S]*?</p>', 'im');
  var match = text.match(regexExpr);
  if (match) {
    return trimHeader(trimHtml(match[0]));
  }

  return 'None';
}

function trimHtml(text) {
  return text.replace(/<.*?>|&amp|\n|\r/g, '');
}

function trimHeader(text) {
  return text.replace(/[\s\S]*?:/, '').trim();
}

function getImageUrl(imageFormula) {
  return imageFormula.slice(0, imageFormula.length - 2).replace(/=image\("?'?/i, '')
}

// Work with HTML
function getElementsByTagName(element, tagName) {
  var data = element.getElements(tagName);
  var elList = element.getElements();
  var i = elList.length;
  while (i--) {
    // (Recursive) Check each child, in document order.
    var found = getElementsByTagName(elList[i], tagName);
    if (found) {
      data = data.concat(found);
    }
  }
  return data;
}

function getElementByClassName(element, className) {
  function containsClass(element) {
    var currClass = element.getAttribute('class');
    if (!currClass) {
      return false;
    }

    var currClass = currClass.getValue();
    return currClass === className ||
           currClass.indexOf(' ' + className) !== -1 ||
           currClass.indexOf(className + ' ') !== -1;
  }

  var elList = element.getElements();
  var data = elList.filter(containsClass);

  var i = elList.length;
  while (i--) {
    // (Recursive) Check each child, in document order.
    var found = getElementByClassName(elList[i], className);
    if (found) {
      data = data.concat(found);
    }
  }

  return data;
}

// Send email with new listing information
function sendEmail() {
  // Only send if there's new items
  if (!updatedItems.length && !newItemsForUpdate.length) return;

  var footer = '<hr>' +
  var newItemsText = newItemsForUpdate.length ? '<hr><h2>New:</h2><br>' + newItemsForUpdate.map(getElementSection).join('') : '';
  var updatedItemsText = updatedItems.length ? '<hr><h2>Updated:</h2><br>' + updatedItems.map(getElementSection).join('') : '';
  var archivedItemsText = '';
  if (Object.keys(contextValues.previousListings).length) {
    archivedItemsText = '<hr><h2>Archived:</h2><br>';
    for (var showUrl in contextValues.previousListings) {
      if (contextValues.previousListings.hasOwnProperty(showUrl)) {
        archivedItemsText += getElementSection(contextValues.previousListings[showUrl]);
      }
    }
  }

  var emailTemplate = newItemsText +
                      updatedItemsText +
                      archivedItemsText +
                      footer;
  var subject = '[CT] *' + newItemsForUpdate.length + '* New || *' + updatedItems.length + '* Updated ' + new Date().toLocaleString();


  // Get information from TotalSavings tab
  var email = MailApp.sendEmail({
    to: myEmail,
    subject: subject,
    htmlBody: emailTemplate,
  });
}

function getElementSection(listingInfo) {
  var imageIdx = contextValues.sheetIndex.Image;
  var titleIdx = contextValues.sheetIndex.Title;
  var locationIdx = contextValues.sheetIndex.Location;
  var dateIdx = contextValues.sheetIndex.Date;
  var categoryIdx = contextValues.sheetIndex.Category;
  var urlIdx = contextValues.sheetIndex.Url;
  var feeIdx = contextValues.sheetIndex.AdminFee;
  var imageUrl = listingInfo[imageIdx] ? getImageUrl(listingInfo[imageIdx])  : '';
  var imageDiv = imageUrl ? '<img src="' + imageUrl + '" alt="' + listingInfo[titleIdx] + '" width="128">' :
                 '';
  var feeDiv = listingInfo[feeIdx] ? (listingInfo[feeIdx] + '<br>') : '';
  var locationDiv = listingInfo[locationIdx] ? (listingInfo[locationIdx] + '<br>') : '';
  var dateDiv = listingInfo[dateIdx] ? (listingInfo[dateIdx] + '<br>') : '';
  var categoryDiv = listingInfo[categoryIdx] ? (listingInfo[categoryIdx] + '<br>') : '';
  return '<h3>' + listingInfo[titleIdx] + '</h3><br>' +
         feeDiv +
         locationDiv +
         dateDiv +
         categoryDiv +
         '<br>' +
         imageDiv +
         '<br><br>' +
         'Url: <a href="' + listingInfo[urlIdx] + '" target="_blank">' + listingInfo[urlIdx] + '</a>' +
         '<hr>';
}

// Function that updates sheet
function updateCellRow() {
  if (!newItemsForUpdate.length) return;

  // Get range by row, column, row length, column length
  var cells = contextValues.sheet.getRange((contextValues.lastRow + 1), 1, newItemsForUpdate.length, newItemsForUpdate[0].length);
  cells.setValues(newItemsForUpdate);
}

// Move expired items to "Archive" sheet
function archiveExpiredItems() {
  // Now archive events that passed
  var cutRange, newRange, currentItem, row, oldValues, oldNotes;
  var toDelete = [];
  var archive = SpreadsheetApp.getActiveSpreadsheet()
                                        .getSheetByName('Archive');
  var archiveData = archive.getDataRange().getValues();
  var lastArchiveRow = numberOfRows(archiveData);
  var imageIdx = contextValues.sheetIndex.Image;
  var currentTime = new Date();
  for (var expiredItem in contextValues.previousListings) {
    if (contextValues.previousListings.hasOwnProperty(expiredItem)) {
      lastArchiveRow++;
      currentItem = contextValues.previousListings[expiredItem];
      row = currentItem.row + 1;
      cutRange = contextValues.sheet.getRange('A' + row + ':I' + row);
      newRange = archive.getRange('A' + lastArchiveRow + ':J' + lastArchiveRow)
      oldValues = cutRange.getValues();
      oldValues[0][imageIdx] = getImageUrl(contextValues.sheetData[currentItem.row][imageIdx]);
      oldValues[0].push(currentTime);
      newRange.setValues(oldValues);
      oldNotes = cutRange.getNotes();
      oldNotes[0].push('');
      newRange.setNotes(oldNotes);
      toDelete.push({
        range: cutRange,
        row: row,
      });
    }
  }

  toDelete.sort(function sortByRow(a, b){
    return b.row - a.row;
  }).forEach(function deleteItem(rangeToDelete) {
    rangeToDelete.range.deleteCells(SpreadsheetApp.Dimension.ROWS);
    Utilities.sleep(200);
  });
}

// Add item information to specific cell, archiving previous value as note
function updateCell(row, key, value) {
  var cellColumn = contextValues.sheetIndex[key];
  if (cellColumn !== undefined) {
    var cellCode = NumberToLetters(cellColumn) + row;
    var cell = contextValues.sheet.getRange(cellCode);
    var previousMessage = cell.getValue();
    if (previousMessage) {
      var oldNote = cell.getNote();
      var previousMessage = new Date().toISOString() + ' overwrote: ' + previousMessage + '\n';
      var currentNote = (oldNote ? oldNote + previousMessage : previousMessage );
      cell.setNote(currentNote);
    }

    cell.setValue(value);
  }
}
