# Mercado Central BI — versão sem banco central

Esta versão foi ajustada para a regra definida: **não grava vendas em banco central**. Os MySQL originais do iServer continuam sendo a fonte permanente. O backend mantém somente cache em memória por até 5 minutos; reiniciar o backend apaga todo esse cache.

## Arquitetura

- `frontend/`: React + TypeScript + Vite + Apache ECharts.
- `backend/`: Node.js + Express. Não usa PostgreSQL, Neon ou qualquer banco de dados.
- `agent/`: agente Node.js instalado no computador/servidor que alcança as três lojas pela VPN. Ele inicia conexões HTTPS de saída com o backend e executa consultas somente leitura quando recebe uma solicitação.

O backend coloca as consultas em uma fila temporária em memória. O agente busca a fila, consulta o MySQL da loja solicitada e devolve o resultado. Nenhum registro de venda é inserido ou atualizado no iServer.

## Regras de atualização

1. Cada combinação de período, loja e filtros tem sua própria chave de cache.
2. Sem atualização manual, um resultado válido é reutilizado por até 5 minutos.
3. Ao clicar em **Atualizar agora**, a consulta ignora o cache, consulta novamente a origem e substitui o resultado anterior daquela combinação de filtros.
4. O frontend mantém filtros e estado da tela. Não recarrega a página.
5. Se uma resposta antiga terminar depois de uma consulta mais nova, o frontend ignora a resposta antiga.
6. O cache é temporário: fica somente na memória do processo do backend e desaparece ao reiniciá-lo.

## Requisitos

- Node.js 20 ou superior.
- Para demonstração: nenhum banco, VPN ou credencial MySQL.
- Para dados reais: computador com VPN e acesso de leitura às três bases MySQL; backend acessível por HTTPS pelo agente.

## A. Testar localmente sem banco (modo demonstração)

### Terminal 1 — backend

No PowerShell, a partir da pasta do projeto:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

O arquivo `backend/.env` deve conter `DEMO_MODE=true` (padrão). Não é necessário editar nenhuma credencial.

### Terminal 2 — frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Abra `http://localhost:5173`.

O dashboard exibirá dados fictícios, identificados como **Modo demonstração**. Os dados não representam o faturamento real das lojas.

## B. Configurar consultas reais

### 1. Backend

No `backend/.env`, configure:

```env
PORT=3001
DEMO_MODE=false
AGENT_TOKEN=coloque-aqui-um-token-longo-e-aleatorio
CACHE_TTL_SECONDS=300
AGENT_JOB_TIMEOUT_SECONDS=60
```

O backend precisa estar publicado ou acessível por HTTPS a partir do computador que executará o agente. Não exponha o MySQL à internet.

### 2. Agente

No computador conectado à VPN, abra `agent/.env.example`, faça uma cópia chamada `.env` e configure:

```env
API_URL=https://SEU-ENDERECO-DO-BACKEND
AGENT_TOKEN=O-MESMO-TOKEN-DO-BACKEND
AGENT_POLL_MS=1500
```

Preencha os campos `STORE_1_*`, `STORE_2_*` e `STORE_3_*` com os dados de conexão de cada loja. Use um usuário MySQL dedicado com permissões somente de leitura; evite `root`. Não envie o arquivo `.env` por chat nem o publique no Git.

Instale e inicie:

```powershell
cd agent
Copy-Item .env.example .env
npm install
npm run dev
```

O agente consulta a fila do backend. Quando o dashboard solicita dados, o backend encaminha uma tarefa ao agente, que consulta a loja correspondente e devolve o resultado.

### 3. Frontend

No `frontend/.env`, configure a URL pública do backend:

```env
VITE_API_URL=https://SEU-ENDERECO-DO-BACKEND
```

Reinicie o Vite depois de alterar o `.env`.

## Funcionalidades incluídas

- Indicadores de faturamento, cupons, ticket médio, custo e lucro bruto estimado.
- Faturamento por dia; clique em um dia para filtrar o painel.
- Distribuição por forma de pagamento; clique em uma fatia para filtrar.
- Ranking de produtos; clique em uma barra para filtrar.
- Filtros de período, loja, grupo, produto e pagamento.
- Consulta individual de cupom por loja, data e número do documento.
- Interface responsiva para desktop e celular.

## Observações importantes antes de produção

- Os testes de estrutura e conciliação enviados até agora foram feitos na conexão identificada pelo usuário como Loja 3. As consultas precisam ser validadas nas Lojas 1 e 2 antes de uso operacional.
- A regra validada até agora usa `status_cupom='A'`, itens com `item_cancelado='N'` e `valor_finalizadora` sem subtrair `troco_finalizadora` do faturamento. O troco é exibido separadamente.
- O cálculo de lucro bruto é uma estimativa baseada em `preco_total_item - custo_total_item` dos itens não cancelados. Deve ser validado por loja e por período.
- A sincronização não é histórica: não há carga nem armazenamento de vendas. Cada solicitação consulta diretamente o MySQL.
- O cache de 5 minutos guarda respostas completas temporariamente na RAM do backend. Se houver reinício, os dados em cache são descartados.
- Configure HTTPS, token forte, firewall e usuário MySQL somente leitura antes de publicar.
- A consulta individual usa loja + data + número do documento. Confirme os formatos de documento usados nas três lojas.
