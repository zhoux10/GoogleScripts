// Instantiate and run constructor
function runDeadlineReminder() {
  // Change this template to change text in automated email
  var reminderEmail = "Hi { firstName },\n\nPlease remember to complete  { bookName } by { NewCycle }. " +
                      "If you are done reading the book, please:\n" +
                      "1) Think back to whether you have moved or not. Update the 'Addresses' tab in the Google Sheet if you have moved. \n" +
                      "2) Fill out the Google Form (https://docs.google.com/forms/d/1j6oYWu4QcadddV2VD0hBQ7XUVbYnwUrAkgowP_jXSaQ/viewform) so you can receive a new book"  +
                      "\n\nHappy reading!",
      subject = '[BOOKCLUB] Reminder For Upcoming Cycle';

  new DeadlineReminder(reminderEmail, subject).run();
}

// Constructor for assigning book
function DeadlineReminder(reminderEmail, subject) {
  var scheduleSheet = SpreadsheetApp.getActiveSpreadsheet()
                                     .getSheetByName("Schedule");
  this.scheduleSheetData = scheduleSheet.getDataRange().getValues();
  this.scheduleSheetIndex = indexSheet(this.scheduleSheetData);

  var formSheet = SpreadsheetApp.getActiveSpreadsheet()
                                 .getSheetByName("Form Responses 1");
  this.formSheetData = formSheet.getDataRange().getValues();
  this.formSheetIndex = indexSheet(this.formSheetData);

  var addressesSheet = SpreadsheetApp.getActiveSpreadsheet()
                                      .getSheetByName("Addresses");
  this.addressesSheetData = addressesSheet.getDataRange().getValues();
  this.addressesSheetIndex = indexSheet(this.addressesSheetData);

  this.reminderEmail = reminderEmail;
  this.subject = subject;

  this.today = new Date();
}

// Main script for running function
DeadlineReminder.prototype.run = function() {
  // Get today's date
  var newCycle = findNextCycle(this.scheduleSheetData, this.scheduleSheetIndex),
      newCycleDate = newCycle[1],
      newCycleRowIdx = newCycle[0],
      newCycleColumnIdx = this.scheduleSheetIndex.NewCycle,
      numberEntries = numberOfRows(this.formSheetData),
      hasNewBookIndex = this.formSheetIndex.HasNewBook,
      finishedNotAssigned = {},
      name, nameIndex, cell,
      emailIdx, currentRow, contactEmail, sheetName, cellCode, emailOptions, updateCellOptions;

  // Only proceed if the current month is the one right before the new cycle
  if (newCycleDate.getMonth() <= this.today.getMonth() + 1 ) {
    // Get hash of people who have finished their book but have not been assigned a new book
    for (var j = 1; j < numberEntries; j++) {
      nameIndex = this.formSheetIndex.Name;
      name = this.formSheetData[j][nameIndex];

      // Mark person as "finished current book, not assigned new book"
      if (!this.formSheetData[j][hasNewBookIndex]) {
        cell = NumberToLetters[hasNewBookIndex] + (j + 1);
        finishedNotAssigned[name] = cell;
      }
    }


    // Go through every column in Schedule tab, send email if the person has not finished book yet -- add note when successfully sent email
    for (var i = 1; i < this.scheduleSheetData[0].length; i++) {
      nameIndex = this.addressesSheetIndex.Name;
      name = this.addressesSheetData[i][nameIndex];

      if (!this.scheduleSheetData[newCycleRowIdx][i] && !finishedNotAssigned[name]) {
        emailIdx = this.addressesSheetIndex.Email;
        currentRow = numberOfRows(this.scheduleSheetData, i);
        contactEmail = this.addressesSheetData[i][emailIdx];
        sheetName = 'Schedule';
        cellCode = NumberToLetters[i] + newCycleRowIdx;
        emailOptions = {
                          NewCycle: currentRow < newCycleRowIdx ?
                                    "ASAP (was due " + createPrettyDate(this.scheduleSheetData[currentRow][newCycleColumnIdx]) + ")" :
                                    createPrettyDate(newCycleDate),
                          bookName: this.scheduleSheetData[currentRow - 1][i],
                          firstName: name
                        };
        updateCellOptions = {
                              note: "Reminder sent: " + this.today,
                              sheetName: sheetName,
                              cellCode: cellCode
                            };

        new Email(contactEmail, this.subject, this.reminderEmail, emailOptions, [updateCellOptions]);
      }
    }
  }
};