const digitalWaste = require('./digitalWaste');

const MB = 1024 * 1024;
const sizeInBytes = 100 * MB;
digitalWaste.saveToFile('./data-waste.bin', sizeInBytes, (err) => {
  if (err) throw err;
  console.log('Large file created successfully');
});
