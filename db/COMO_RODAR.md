# Como criar o banco no MySQL (Windows / PowerShell)

Guia para criar o banco `entrega_fila_agua` a partir do arquivo
`schema.sql`, usando o **MySQL 8.0 Command Line Client** que você já tem
instalado.

O `schema.sql` já contém `CREATE DATABASE`, todas as tabelas, índices, chaves
estrangeiras e o seed inicial (produtos de água + usuário admin). Ele também
faz `DROP TABLE` das tabelas antes de recriar, então pode ser rodado de novo com
segurança para recriar tudo do zero.

> ⚠️ Rodar de novo **apaga e recria** as tabelas (perde os dados). Use só quando
> quiser resetar o banco.

---

## Passo 1 — Abrir o PowerShell na pasta do projeto

```powershell
cd D:\entrega-fila-agua\db
```

Confirme que o arquivo está aí:

```powershell
dir schema.sql
```

## Passo 2 — Garantir que o `mysql` está no PATH

Teste se o cliente responde:

```powershell
mysql --version
```

Se aparecer "mysql não é reconhecido...", use o caminho completo do executável
(ajuste a versão da pasta se necessário):

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" --version
```

Nos comandos abaixo, onde estiver `mysql`, substitua por esse caminho completo
entre aspas caso precise.

## Passo 3 — Rodar o schema

```powershell
Get-Content schema.sql | mysql -u root -p
```

Vai pedir a senha do usuário `root` do MySQL. Digite e pressione Enter. Se não
aparecer nenhuma mensagem de erro, deu certo.

> Se o seu `Get-Content` reclamar de acentuação (utf8), force o encoding:
>
> ```powershell
> Get-Content -Encoding UTF8 schema.sql | mysql -u root -p
> ```
>
> Alternativa equivalente, sem pipe:
>
> ```powershell
> mysql -u root -p -e "source D:\entrega-fila-agua\db\schema.sql"
> ```

## Passo 4 — Verificar que as tabelas foram criadas

```powershell
mysql -u root -p -e "USE entrega_fila_agua; SHOW TABLES;"
```

Você deve ver exatamente estas 8 tabelas:

```
+-----------------------------+
| Tables_in_entrega_fila_agua |
+-----------------------------+
| auditoria                   |
| clientes                    |
| lote_pedidos                |
| lotes_entrega               |
| pedido_itens                |
| pedidos                     |
| produtos                    |
| usuarios                    |
+-----------------------------+
```

## Passo 5 — Conferir o seed (opcional)

```powershell
mysql -u root -p -e "USE entrega_fila_agua; SELECT id, nome, preco FROM produtos; SELECT id, perfil, email FROM usuarios;"
```

Deve retornar os produtos de água e o usuário admin inicial.

---

## Verificações extras (opcional)

Ver as chaves estrangeiras criadas:

```powershell
mysql -u root -p -e "USE entrega_fila_agua; SELECT table_name, constraint_name, referenced_table_name FROM information_schema.key_column_usage WHERE table_schema='entrega_fila_agua' AND referenced_table_name IS NOT NULL;"
```

Testar a query da fila (ordem: urgente, vip, normal; depois FIFO por `criado_em`):

```powershell
mysql -u root -p -e "USE entrega_fila_agua; SELECT id, prioridade, criado_em FROM pedidos WHERE status='na_fila' ORDER BY FIELD(prioridade,'urgente','vip','normal'), criado_em ASC;"
```

---

## Problemas comuns

- **`Access denied for user 'root'`** — senha errada. Use a senha definida na
  instalação do MySQL.
- **`Unknown database 'entrega_fila_agua'` no Passo 4** — o Passo 3 não rodou até
  o fim. Repita o Passo 3 observando a mensagem de erro.
- **`mysql não é reconhecido`** — use o caminho completo do `mysql.exe` (Passo 2)
  ou adicione `C:\Program Files\MySQL\MySQL Server 8.0\bin` ao PATH do Windows.
- **Acentos aparecem errados** — use `Get-Content -Encoding UTF8` (o banco já é
  `utf8mb4`).

---

## Observação sobre o teste

Este `schema.sql` foi executado e validado com sucesso em um servidor
MariaDB 10.6 (compatível com a sintaxe MySQL 8.0): rodou sem erros, criou as 8
tabelas, aplicou as 9 chaves estrangeiras, inseriu o seed, e o índice
`idx_pedidos_fila` foi confirmado (via `EXPLAIN`) como o índice usado pela query
da fila. A sintaxe usada (`ENGINE=InnoDB`, `utf8mb4`, `ENUM`, `DECIMAL`,
`TIMESTAMP DEFAULT CURRENT_TIMESTAMP`) é totalmente suportada pelo MySQL 8.0.
