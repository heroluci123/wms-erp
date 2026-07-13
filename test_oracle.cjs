const oracledb = require('oracledb');

async function run() {
  let connection;

  try {
    console.log('Connecting to Oracle...');
    connection = await oracledb.getConnection({
      user: "OSPLUS",
      password: "SWXAQZ33",
      connectString: "10.12.50.11:1521/orcl.FRIGODIS.CP"
    });

    console.log("Successfully connected to Oracle!");
    
    const result = await connection.execute(
      `SELECT table_name FROM user_tables WHERE ROWNUM <= 10`
    );
    console.log('Sample tables:');
    console.log(result.rows);

  } catch (err) {
    console.error('Connection failed:', err);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
}

run();
