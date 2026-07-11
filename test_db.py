import sqlite3

try:
    conn = sqlite3.connect('data/wms.db')
    cursor = conn.cursor()
    cursor.execute("SELECT endereco, qtd_caixas, produto_id FROM estoque_posicao WHERE endereco LIKE 'CON%'")
    rows = cursor.fetchall()
    print("estoque_posicao:")
    for row in rows:
        print(row)
        
    cursor.execute("SELECT endereco FROM locais WHERE endereco LIKE 'CON%'")
    locais = cursor.fetchall()
    print("locais:")
    for loc in locais:
        print(loc)
        
except Exception as e:
    print(e)
finally:
    if 'conn' in locals():
        conn.close()
