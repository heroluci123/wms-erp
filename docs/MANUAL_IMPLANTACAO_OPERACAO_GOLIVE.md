# Manual & Playbook Definitivo — Implantação, Operação e Go-Live (WMSphere ERP)

Guia oficial para colocar o **WMSphere ERP** em produção na nuvem, instalar nos celulares (iPhone iOS & Android PWA), estruturar os cadastros iniciais (Dia 0) e operar todos os setores da empresa ponta a ponta.

---

## 1. Arquitetura de Produção

```mermaid
flowchart LR
  subgraph Clientes["Usuários (Desktop, Coletores, Celulares iOS/Android PWA)"]
    WEB["Navegador / Desktop"]
    PWA["iPhone & Android PWA\n(Motorista • Vendas • Coletor • PDV)"]
  end

  subgraph Cloud["Infraestrutura em Nuvem"]
    VERCEL["Vercel (Frontend React/Vite)\nhttps://wms-erp-cow3.vercel.app"]
    API["Render / Railway / Docker\nAPI Fastify + TypeScript\nGET /api/health"]
    PG[("PostgreSQL Gerenciado\nNeon ou Supabase (SSL)")]
  end

  WEB --> VERCEL
  PWA --> VERCEL
  VERCEL -- "HTTPS + JWT + x-filial-id\n(VITE_API_URL)" --> API
  API -- "Drizzle ORM + pg.Pool (SSL)" --> PG
```

---

## 2. Deploy em Produção Passo a Passo (15 Minutos)

### Passo 1 — Criar o Banco PostgreSQL na Nuvem (Neon ou Supabase)
1. Crie uma conta gratuita em **neon.tech** (recomendado pela simplicidade) ou **supabase.com**.
2. Crie um novo projeto (ex.: `wmsphere-prod`, região `South America (São Paulo)` se disponível, ou `US East`).
3. Copie a **Connection String** (`DATABASE_URL`), no formato:
   ```text
   postgresql://USUARIO:SENHA@HOST/DATABASE?sslmode=require
   ```
4. **Não é necessário rodar SQL manual:** na primeira inicialização da API, o script `runMigrationsAndSeed()` cria automaticamente todas as tabelas, índices e o tenant/usuário inicial.

---

### Passo 2 — Publicar a API Backend (Escolha 1 opção)

#### Opção A (Mais fácil — 1 Clique): Render.com com Blueprint (`render.yaml`)
O repositório já possui o arquivo [render.yaml](../render.yaml) na raiz configurado para a pasta `server/`.
1. Acesse **dashboard.render.com** → clique em **New +** → **Blueprint**.
2. Conecte o repositório GitHub `heroluci123/wms-erp` (branch `main`).
3. O Render lerá `render.yaml` automaticamente. Preencha as variáveis solicitadas:

| Variável | Valor Recomendado |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PG_DRIVER` | `pg` |
| `DATABASE_URL` | Cole a URL `postgresql://...` do Neon ou Supabase |
| `JWT_SECRET` | Gerado automaticamente pelo Render (mínimo 32 caracteres aleatórios) |
| `CORS_ORIGIN` | `https://wms-erp-cow3.vercel.app,https://*.vercel.app` |

4. Clique em **Apply / Deploy** e aguarde ~2 minutos.
5. Anote a URL pública gerada (ex.: `https://wms-erp-api.onrender.com`).

> **Dica para operação comercial 24/7:** o plano gratuito do Render hiberna após 15 min sem acessos (~30s para acordar). Quando a operação começar a rodar diariamente, recomenda-se o plano **Starter (~US\$ 7/mês)** no Render ou **Railway**.

#### Opção B: Railway ou VPS Docker (`server/Dockerfile`)
O repositório já inclui [server/Dockerfile](../server/Dockerfile) pronto com healthcheck.
- No **Railway**: *New Project → Deploy from GitHub Repo* → Root Directory `server` → configure as mesmas 5 variáveis acima (`PORT` é injetada automaticamente).
- Em **VPS com Docker**:
  ```bash
  docker build -t wms-erp-api ./server
  docker run -d --name wms-erp-api --restart unless-stopped \
    -p 3333:3333 \
    -e NODE_ENV=production \
    -e PG_DRIVER=pg \
    -e DATABASE_URL="postgresql://..." \
    -e JWT_SECRET="gere-uma-chave-aleatoria-com-48-caracteres" \
    -e CORS_ORIGIN="https://wms-erp-cow3.vercel.app" \
    wms-erp-api
  ```

---

### Passo 3 — Conectar o Frontend na Vercel (`VITE_API_URL`)
1. Acesse **vercel.com** → abra o projeto `wms-erp` (`https://wms-erp-cow3.vercel.app`).
2. Vá em **Settings → Environment Variables**.
3. Crie a variável:
   - **Key:** `VITE_API_URL`
   - **Value:** URL da sua API publicada (ex.: `https://wms-erp-api.onrender.com` — **sem `/` no final**)
   - **Environments:** marque *Production*, *Preview* e *Development*.
4. Vá em **Deployments**, clique nos `...` do último deploy e escolha **Redeploy** (o Vite embute `VITE_API_URL` durante o build!).

---

### Passo 4 — Teste de Fumaça Pós-Deploy (3 Minutos)
1. **Saúde da API:** abra `https://SUA-API/api/health` no navegador e confirme:
   ```json
   { "ok": true, "driver": "pg", "service": "wms-erp-server", "node_env": "production" }
   ```
2. **Login Inicial & Segurança:** abra a URL da Vercel, entre com o usuário padrão (`Luciano` / `7410`) e **troque imediatamente a senha** clicando no ícone de chave no canto superior direito.
3. **Diagnóstico Automático:** no menu lateral, abra **Cadastros → Manual & Go-Live** (`/#/golive-manual`) e confirme os 3 indicadores de infraestrutura verdes (PostgreSQL Real, JWT Forte e CORS).

---

## 3. Instalação no Celular (iPhone iOS & Android PWA)

O WMSphere é um **PWA (Progressive Web App)** — funciona como aplicativo instalado em tela cheia **sem precisar publicar na App Store ou Google Play**, com acesso nativo à câmera (foto de canhoto), assinatura na tela, leitor QR e GPS.

### iPhone / iPad (iOS)
1. Abra a URL da Vercel no **Safari** *(obrigatório usar o Safari no iOS)*.
2. Se quiser fixar diretamente um módulo específico no ícone:
   - Motorista: `https://wms-erp-cow3.vercel.app/#/motorista`
   - Força de Vendas: `https://wms-erp-cow3.vercel.app/#/forca-vendas`
   - Sistema completo / Coletor: `https://wms-erp-cow3.vercel.app/`
3. Toque no botão **Compartilhar** (ícone de quadrado com seta para cima na barra inferior).
4. Toque em **"Adicionar à Tela de Início"** → confirme em **Adicionar**.

### Android (Chrome)
1. Abra a URL da Vercel no **Google Chrome**.
2. Toque no aviso **"Instalar aplicativo"** (ou menu **⋮** → *Adicionar à tela inicial*).
3. Pressionando o ícone instalado, aparecem atalhos rápidos para **App Motorista**, **Força de Vendas** e **PDV**.

---

## 4. Implantação Inicial — Ordem Exata dos Cadastros (Dia 0)

Execute esta sequência uma única vez ao iniciar com o banco limpo:

| Ordem | Tela / Módulo | O que configurar |
| :---: | :--- | :--- |
| **1** | **Usuários e Permissões** (`/operadores`) | Trocar senha MASTER, criar perfis separados (Expedição, Produção, Faturamento, Vendedor, Caixa PDV, Açougue, Motorista) e definir PIN gerencial de supervisor. |
| **2** | **Empresas & Filiais** (`/filiais`) | Razão social, CNPJ, IE, endereço, registro **SIF/DIPOA** e definição de filiais (Indústria/CD e Loja/Varejo). |
| **3** | **Parâmetros Comerciais & Fiscais** (`/parametros-comerciais`) | Formas de pagamento, contas bancárias, centros de custo, naturezas/CFOP, matriz tributária e alçada de margem mínima. |
| **4** | **Cadastro de Taras** (`/taras`) | Caixas plásticas, papelão e bandejas com peso exato em kg (carregado e travado na balança). |
| **5** | **Cadastro de Locais** (`/locais`) | Endereços das câmaras frias (`CAM-01`, ruas/posições), doca `REC`, `EXPEDICAO`, `ACOUGUE` e `EMPORIO`. |
| **6** | **Produtos & Especificações** (`/produtos`) | 1º crie as **Especificações de Rótulo Industrial (100×70)**; 2º cadastre Carnes (MP/Subproduto + Árvore BOM), Empório (com fator fardo → UN) e Insumos. **Curva ABC é 100% automática.** |
| **7** | **Tabelas de Preço** (`/tabelas-preco`) | Tabela Padrão Atacado, Tabelas Especiais por cliente e preços de Varejo/Açougue/Empório. |
| **8** | **Fornecedores, Clientes, Vendedores & Rotas** | Fornecedores com registro SIF, clientes atacado com limite de crédito/tabela, vendedores com metas e veículos/rotas. |
| **9** | **Carga Inicial de Estoque** (`/inventario`) | Crie um inventário tipo **`CargaInicial`** ou realize o recebimento das caixas existentes nas câmaras para partir com estoque 100% auditado. |

---

## 5. Manual Operacional Ponta a Ponta (Rotinas por Setor)

### Fluxo A — Compras, Cotação (RFQ), Recebimento & Armazenagem
1. **Cotação de Compra (RFQ):** em `/governanca-perdas` → aba **Cotações (RFQ)**, abra a cotação, lance propostas de fornecedores e aprove o vencedor (gera o Pedido de Compra automaticamente com registro de economia).
2. **Importação XML / Pedido de Compra:** em `/compras`, acompanhe pedidos em aberto ou importe o XML da NF-e.
3. **Recebimento na Doca:** em `/recebimento`, informe a temperatura de chegada (°C — alimenta o **Score SIF do Fornecedor**), bipe/pese as caixas com tara automática e imprima etiquetas 100×70mm se necessário.
4. **Endereçamento:** em `/movimentacao`, leve o palete/caixas de `REC` para o endereço da câmara fria.

### Fluxo B — Indústria: Mapa de Produção → OP de Desossa → Retorno & Custos
1. **Planejamento:** em `/mapa-producao`, consolide a necessidade do dia (vinda dos pedidos e programação semanal) e libere a OP.
2. **Saída de Matéria-Prima:** em `/producao`, bipe as caixas de MP alocadas na OP *(estas saídas alimentam automaticamente a Curva ABC da matéria-prima)*.
3. **Retorno de Produção:** pese cada caixa de corte/subproduto gerado, aplique a tara e imprima a etiqueta industrial 100×70mm com especificação DIPOA, lote e validade.
4. **Fechamento & Rendimento:** finalize a OP — o sistema calcula rendimento %, quebra %, aloca o custo real nos cortes e aciona o **Alarme de Furo de Rendimento** em Governança se ficar abaixo da meta BOM.

### Fluxo C — Comercial Atacado, Faturamento, Separação FEFO, Embarque & Entrega
*(Roteiro completo de ponta a ponta para teste geral e operação diária)*

1. **Criação do Pedido:** em `/pedidos` (desktop) ou `/forca-vendas` (celular PWA), escolha cliente, tabela de preço, forma de pagamento e itens usando a busca inteligente.
   - Se algum item ficar abaixo da margem mínima, o pedido vai para **Central de Pendências** (`/pendencias`) para liberação gerencial.
2. **Faturamento & Financeiro:** libere o pedido, gere o faturamento / NF-e (`/fiscal`) e os títulos a receber no **Financeiro** (`/financeiro`).
3. **Separação com Trava FEFO:** em `/saida`, abra o pedido e bipe as caixas na câmara fria.
   - **Caixa vencida:** bloqueio rígido (`Hard-Stop FEFO`), não permite expedir.
   - **Furo de fila FEFO** (caixa válida, mas há lote vencendo antes): exige **PIN gerencial** e grava evidência no **Radar Antifraude**.
4. **Conferência de Expedição:** realize a conferência das caixas do romaneio (peso e quantidade).
5. **Romaneio de Embarque & Carregamento:** em `/roteirizacao`, monte o embarque (veículo, capacidade kg, motorista, pedidos/romaneios), registre temperatura do baú e conclua o carregamento.
6. **Impressão:** imprima o Pedido ou Romaneio em A4 paisagem (página única otimizada).
7. **Entrega pelo App Motorista:** o motorista abre `/#/motorista` no iPhone/Android (ou lê o QR do embarque), registra início da rota, chegada no cliente, foto do canhoto, assinatura na tela, temperatura na entrega e pagamento na entrega (se aplicável).
8. **Rastreio do Cliente:** envie o link público `/#/rastreio-pedido/<token>` para o cliente acompanhar a entrega em tempo real.

### Fluxo D — Loja / Varejo: Transferência CD → Açougue → Empório → PDV
1. **Transferência Interunidades:** em `/interunidades`, transfira caixas/fardos do CD para a Filial Loja.
2. **Operação do Açougue:** em `/acougue`, abra a MP recebida no balcão, pese as bandejas/cortes e emita etiquetas QR de venda (tara e validade travadas pelo cadastro do produto).
3. **Estoque Empório:** em `/emporio`, lance entradas de bebidas/carvão/mercearia com conversão automática de fardo → unidade.
4. **PDV Frente de Caixa:** em `/pdv`, abra o caixa com fundo de troco, bipe etiquetas QR do açougue e códigos EAN-13 do empório, receba em PIX/Cartão/Dinheiro/Crediário e realize o fechamento cego conferindo eventual quebra de caixa.

### Fluxo E — Governança, Loss Prevention, Inventário & Central BI
- **Diário:** Ronda de Temperatura SIF (2×–3×/dia), Monitor FEFO & Promoção e Radar Antifraude em `/governanca-perdas`.
- **Semanal:** Inventário Cíclico por **Curva A** (calculada 100% automaticamente por Produção + Açougue + Vendas Diretas) em `/inventario`.
- **Gerencial:** **DRE Gerencial** (`/dre`) e **Central de Relatórios & BI** (`/relatorios`) com **4 Relatórios Clássicos WMS + 15 Indicadores BI** (incluindo *Curva ABC Automática*, *Valuation*, *Kardex*, *Giro & Dead Stock*, *Mapa FEFO*, *IRA*, *Rentabilidade*, *Fechamento PDV*, *Comissões*, *Açougue*, *Inflação de Compras*, *OTIF*, *Devoluções* e *Interunidades/Perdas*).

---

## 6. Padrão de Impressoras, Equipamentos & Segurança

| Item | Recomendação de Produção |
| :--- | :--- |
| **Etiquetas 100×70mm** | Térmica Zebra / Elgin / Argox • Papel 100×70mm • Margens `0mm` • Escala `100%` • Sem cabeçalho/rodapé do navegador. |
| **Cupom PDV 80mm** | Térmica 80mm (Epson TM-T20X / Elgin i8 / Bematech) • Margens `0mm`. |
| **Documentos A4** | Laser/Jato A4 ou PDF • Orientação Paisagem (automática). |
| **Leitor de Barras/QR** | USB ou Bluetooth em modo **HID (Teclado)** com sufixo **Enter (CR)**. |
| **Backup de Banco** | Neon e Supabase mantêm Point-in-Time Recovery automático; recomenda-se também `pg_dump` semanal automatizado para bucket seguro. |
| **Segurança** | Nunca usar senha padrão (`7410`) em produção; criar um login individual por colaborador para rastreabilidade completa em auditorias e Radar Antifraude. |

---

## 7. Checklist Final de Go-Live (Assinatura de Virada)

- [ ] Banco PostgreSQL (Neon/Supabase) criado e `DATABASE_URL` configurada com SSL.
- [ ] API publicada (Render/Railway/Docker) respondendo `{"ok": true, "driver": "pg"}` em `/api/health`.
- [ ] `JWT_SECRET` forte (>= 32 chars) e `CORS_ORIGIN` configurado para o domínio da Vercel.
- [ ] `VITE_API_URL` configurada na Vercel + **Redeploy** concluído.
- [ ] Senha do usuário MASTER alterada + operadores da equipe cadastrados com perfis individuais.
- [ ] Diagnóstico em **Manual & Go-Live** (`/golive-manual`) com todos os itens obrigatórios em **Pronto**.
- [ ] 1 teste completo realizado ponta a ponta (Recebimento → OP → Pedido → Separação FEFO → Embarque → App Motorista → PDV → BI).
- [ ] PWA instalado no iPhone/Android dos motoristas e vendedores.
