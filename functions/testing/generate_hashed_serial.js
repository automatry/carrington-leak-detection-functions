const crypto = require('crypto');
const serial = 'TESTSERIAL123';
const hash = crypto.createHash('sha256').update(serial).digest('hex');
console.log(hash);