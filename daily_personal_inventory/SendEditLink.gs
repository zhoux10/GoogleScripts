// Instantiate and run constructor
function runSendEditLink() {
  // Change this template to change text in automated email
  var reminderEmail = "Edit link: { link }\n" + asReported,
      subject = "Edit Link for Daily Personal Inventory (" + currentDate + ")",
      sendTo = '7a828627@opayq.com';

  Utilities.sleep(3 * 1000);
  new getEditLink(reminderEmail, subject, sendTo).run();
}

// Store email template, subject, and sendto
function getEditLink(emailTemplate, subject, sendTo) {
  var form = FormApp.openById('1kL9sSIQbbBnb3Botbf0RuJepG6ird_GXqUwkSZ1oTg4'); //form ID
  this.responses = form.getResponses(); //get email responses

  this.spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
                                   .getSheetByName("Daily Inventory Data");
  this.responseSheetData = this.spreadsheet.getDataRange().getValues();
  this.responseSheetIndex = indexSheet(this.responseSheetData);

  this.emailTemplate = emailTemplate;
  this.subject = subject;
  this.sendTo = sendTo;

  this.today = new Date();
}

// gets editLink for form and updates spreadsheet/sends link if it's for current day
getEditLink.prototype.run = function () {
  var startRow = 3,  // First row of data to process
      numberEntries = this.responseSheetData.length - startRow,// figure out what the last row is (the first row has 2 entries before first real entry)
      editLinkIdx = this.responseSheetIndex.EditLink,
      timestampIdx = this.responseSheetIndex.Timestamp,
      dateIdx = this.responseSheetIndex.Date,
      hoursSleepIdx = this.responseSheetIndex['How many hours did you sleep?'],
      checkTimestamp = function(response){
                          var rTimestamp = response.getTimestamp();
                          if (timestamp.getTime() === rTimestamp.getTime()) {
                            return response;
                          }
                       };

  // Go through each line and check to make sure it has an editLink
  for (var i = 0; i < numberEntries ; i++) {
    var rowIdx = startRow + i,
        editLink = this.responseSheetData[rowIdx][editLinkIdx],
        timestamp = this.responseSheetData[rowIdx][timestampIdx],
        entryDate = this.responseSheetData[rowIdx][dateIdx],
        sleepTime = this.responseSheetData[rowIdx][hoursSleepIdx];

    // If there is not an editLink, put it in, so long as form timestamp and spreadsheet timestamp match
    if (!editLink){
      var response = this.responses.filter(checkTimestamp)[0],
          formUrl = response.getEditResponseUrl(); //grabs the url from the form

          var cellcode = NumberToLetters(editLinkIdx) + (rowIdx + 1),
              emailOptions = {
                  link: formUrl,
                  timestamp: timestamp
                },
              updateCellOptions = {
                  sheetName: 'Daily Inventory Data',
                  cellCode: cellcode,
                  message: formUrl,
                },
              email;


        // Only send edit link if today is the day that the entry is about
        if (sameDay(this.today, entryDate)) {
          updateCellOptions.note = "Reminder sent: " + this.today;
          email = new Email(this.sendTo, this.subject, this.emailTemplate, emailOptions, [updateCellOptions]);
          email.send();
        } else {
          updateCellOptions.note = "Script ran: " + this.today;
          email = new Email(this.sendTo, this.subject, this.emailTemplate, emailOptions, [updateCellOptions]);
          email.updateCell();
        }
    }
    if (!sleepTime) {
      // If user hasn't put in sleep time, insert sleep like an android sleep time and info
      this.getSleep(entryDate, rowIdx, hoursSleepIdx);
    }
  }
};

// Gets sleep info from calendar inserted by Sleep like an Android
getEditLink.prototype.getSleep = function(currDate, row, sleepIdx) {
  var sleepCalendar = CalendarApp.getCalendarsByName("Sleep")[0],
      startTime = new Date(currDate),
      endTIme = new Date(currDate),
      cellcode = NumberToLetters(sleepIdx) + (row + 1),
      eventLength = 0,
      eventDescription = "",
      updateCellOptions;

  startTime.setDate(currDate.getDate() - 1);
  startTime.setHours(22);
  endTIme.setHours(22);

  var sleepEvents = sleepCalendar.getEvents(startTime, endTIme);

  for (var i = 0; i < sleepEvents.length; i++) {
    eventLength += (sleepEvents[i].getEndTime() - sleepEvents[i].getStartTime());
    eventDescription += ("\n\n" + sleepEvents[i].getDescription());
  }

  updateCellOptions = {
    sheetName: 'Daily Inventory Data',
    cellCode: cellcode,
    message: eventLength / 1000 / 60 / 60,
    note: eventDescription,
  };

  new Email(null, null, null, null, [updateCellOptions]).updateCell();
};