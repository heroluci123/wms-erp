const { db } = require('./src/lib/db.js'); db.execute('PRAGMA table_info(locais)').then(res = 
