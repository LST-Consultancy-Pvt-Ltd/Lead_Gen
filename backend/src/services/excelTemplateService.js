const XLSX = require('xlsx');

function generateTemplate() {
  const headers = [
    'Company Name',
    'Lead Type',
    'Contact Name',
    'Job Title',
    'Email',
    'Phone',
    'Lead Status',
    'Lead Source',
    'Score',
    'Follow-up Date',
    'Assign Lead To',
    'Website',
    'Industry',
    'Location',
    'Description / Notes',
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateTemplate };
