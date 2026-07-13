const oracledb = require('oracledb');

async function searchEtq() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: "OSPLUS",
      password: "SWXAQZ33",
      connectString: "10.12.50.11:1521/orcl.FRIGODIS.CP"
    });

    const val = '0025593208001975';
    console.log("Checking CONTLOTE_ETQ...");
    const q1 = await connection.execute(`SELECT * FROM CONTLOTE_ETQ WHERE ROWNUM <= 5`);
    console.log(q1.metaData.map(m => m.name));
    
    // Check ETIQUETA as well
    const q3 = await connection.execute(`SELECT * FROM ETIQUETA WHERE ROWNUM <= 1`);
    console.log("ETIQUETA cols:", q3.metaData.map(m => m.name));

  } catch (err) {
    console.error(err);
  } finally {
    if (connection) await connection.close();
  }
}

searchEtq();
