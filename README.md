# Sistema de Inventário FabLab

API REST para gerir usuários, clientes, itens e empréstimos de um FabLab. Desenvolvida com Node.js, TypeScript, Express, Prisma e PostgreSQL.

## Requisitos

- Node.js `^20.19`, `^22.12` ou `>=24`
- npm 10+
- Docker com Compose, ou uma instância PostgreSQL 18

## Configuração local

```bash
npm install
cp .env.example .env
```

Substitua os segredos JWT do `.env`. Para gerar valores adequados:

```bash
openssl rand -base64 48
```

Use resultados diferentes em `JWT_SECRET` e `JWT_SECRET_REFRESH`. A aplicação recusa configurações ausentes, segredos curtos ou segredos iguais.

Inicie o banco, aplique as migrações e execute a API:

```bash
npm run start:db
```

Ou execute cada etapa separadamente:

```bash
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run dev
```

A API usa `http://localhost:3000` por padrão. Abra [o estoque](http://localhost:3000/inventario/) e entre com uma conta do FabLab para pesquisar, filtrar por disponibilidade e cadastrar itens. Ao recarregar a página, entre novamente.

Selecione o nome de um item para editar seu nome, categoria ou localização. Para alterar a quantidade total, informe o motivo do ajuste.

Se outra pessoa alterar o mesmo campo, a edição mostra o valor atual do estoque e mantém seu rascunho para revisão.

Use **Registrar empréstimo** na edição do item. Busque pelo nome ou use o e-mail completo para localizar o cadastro exato. Selecione o cliente e informe a quantidade e o prazo de devolução no horário local. Se a tela perder a resposta da API, **Reenviar cadastro** usa a mesma tentativa nesta aba.

Quando o cliente ainda não tiver cadastro, abra **Cadastrar cliente** no próprio empréstimo. Um e-mail já cadastrado aparece para conferência e seleção.

Abra **Empréstimos do item** na edição para consultar as unidades emprestadas, os nomes e IDs dos clientes e os prazos de devolução.

O filtro **Situação dos empréstimos** abre em **Ativos**. Use **Atrasados** para ver os prazos vencidos e **Devolvidos**, **Cancelados** ou **Todos** para consultar o histórico com as datas de devolução e cancelamento.

Na tela principal do estoque, **Prazos de empréstimos** abre em **Atrasados**. Selecione **Próximos 7 dias** para ver os empréstimos que vencem nas próximas 168 horas. As duas listas ordenam os registros por prazo e mostram a localização e o ID de cada item. O filtro **Próximos 7 dias** também está disponível nas listas por item e por cliente.

Use **Empréstimos por cliente** para buscar pelo nome ou localizar um cadastro pelo e-mail completo. Selecione o cliente e abra os empréstimos ativos, ou mude o filtro para consultar o histórico desse cliente.

Use **Prorrogar prazo** em um empréstimo ativo e informe um novo prazo no horário local. Se outra pessoa alterar o empréstimo, confira o prazo atualizado antes de enviar novamente.

Use **Registrar devolução** para devolver todas as unidades de um empréstimo. Se o empréstimo mudar antes da confirmação, confira o registro atualizado antes de tentar novamente. O estoque reflete a devolução ao voltar à lista de itens.

Para corrigir uma devolução registrada por engano, abra **Devolvidos** na lista do item ou do cliente e use **Reabrir empréstimo**. A ação volta a reservar todas as unidades, se houver saldo disponível.

Administradores podem usar **Cancelar empréstimo** em empréstimos ativos. O cancelamento repõe todas as unidades no estoque e fica registrado no histórico.

Administradores podem abrir **Histórico de ajustes** na edição do item para consultar quantidades, motivos, datas e contas responsáveis.

Para verificar o servidor:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

### Atualização de uma instalação existente

Faça backup antes de `npm run db:deploy`. A migração recusa dados que já violem as novas regras. Verifique previamente e corrija conscientemente qualquer resultado:

```sql
SELECT * FROM "Item"
WHERE "totalQuantity" < 0
   OR "availableQuantity" < 0
   OR "availableQuantity" > "totalQuantity";

SELECT LOWER("email"), COUNT(*) FROM "User"
GROUP BY LOWER("email") HAVING COUNT(*) > 1;

SELECT LOWER("email"), COUNT(*) FROM "Client"
GROUP BY LOWER("email") HAVING COUNT(*) > 1;
```

Mudanças incompatíveis: criação de usuários agora exige `ADMIN`; erros usam `{ error: { code, message } }`; criação de item exige `totalQuantity` e não aceita `availableQuantity`; alterações de quantidade exigem `adjustmentReason`; criações retornam 201; exclusões retornam 204; e excluir um empréstimo agora o cancela sem apagar o histórico.

## Primeiro administrador

A criação de usuários exige um administrador; não existe cadastro público. Numa instalação nova, defina `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` no `.env`, depois execute:

```bash
npm run db:bootstrap-admin
```

O comando só cria um usuário quando ainda não existe nenhum administrador. Depois disso, administradores podem criar outros usuários e atribuir `ADMIN` ou `OPERATOR` pela API.

### Dados de exemplo

Para preencher uma base de desenvolvimento descartável, defina senhas próprias em `SEED_ADMIN_PASSWORD` e `SEED_OPERATOR_PASSWORD`, depois execute:

```bash
npm run db:seed
```

O seed pede confirmação porque substitui os dados existentes. Para automação em uma base descartável, use `npm run db:seed -- --yes`. Toda a operação é atômica: uma falha restaura os dados anteriores.

## Comandos

| Comando | Finalidade |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com reload |
| `npm run build` | Gera Prisma e compila a aplicação em `dist/` |
| `npm start` | Executa a compilação de produção |
| `npm run typecheck` | Verifica aplicação, seed e testes |
| `npm test` | Testes unitários; integração é habilitada por `RUN_DB_TESTS=true` |
| `npm run test:coverage` | Testes com relatório de cobertura |
| `npm run lint` | Lint e verificação de formatação |
| `npm run check` | Lint, tipos, testes e build |
| `npm run db:migrate` | Cria/aplica migração em desenvolvimento |
| `npm run db:deploy` | Aplica migrações existentes |
| `npm run db:bootstrap-admin` | Cria com segurança o primeiro administrador |
| `npm run db:seed` | Recria os dados de demonstração |

## Regras importantes

- `ADMIN`: administra usuários e seus papéis, e pode executar todas as operações. O último administrador não pode ser excluído nem rebaixado.
- `OPERATOR`: consulta dados e cria/atualiza clientes, itens e empréstimos.
- A quantidade disponível de um item não é editável pela API. Ela é atualizada por empréstimos, devoluções e cancelamentos.
- Ao alterar a quantidade total, a quantidade disponível é recalculada preservando as unidades emprestadas.
- Alterações da quantidade total exigem um motivo e geram um registro de auditoria com o operador responsável.
- Devoluções e reaberturas são serializadas no banco e são seguras contra requisições simultâneas.
- `DELETE /loan/:id` cancela o empréstimo e preserva o histórico; não remove a linha.
- E-mails são normalizados em minúsculas e os corpos rejeitam campos desconhecidos.
- Listas são limitadas a 100 registros por requisição.

## API

A especificação completa está em [openapi.yaml](./openapi.yaml), e exemplos voltados ao frontend estão em [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

Resumo:

- `/auth`: login, refresh, logout e revogação de todas as sessões
- `/user`: administração de usuários e alteração da própria senha
- `/client`: CRUD e histórico de empréstimos
- `/item`: CRUD e filtros por categoria/localização
- `/loan`: criação, consulta, devolução/reabertura e cancelamento
- `/health`: liveness e readiness

Todos os erros usam o mesmo formato:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descrição do erro."
  }
}
```

## Segurança e integridade

- Senhas com bcrypt (cost 12) e mínimo de 12 caracteres; o limite de 72 bytes evita truncamento silencioso do bcrypt.
- JWTs de acesso e refresh usam segredos e finalidades diferentes, algoritmo fixo, issuer e audience.
- Refresh tokens são armazenados como hash, rotacionados de forma atômica e podem ser revogados.
- Login/refresh e a API possuem rate limiting.
- Helmet, limite de corpo JSON e allowlist de CORS habilitados.
- Quantidades e ordem das datas também são protegidas por constraints PostgreSQL.
- Operadores responsáveis por criar, devolver ou cancelar empréstimos são registrados.
- Logs estruturados omitem credenciais e tokens.

Não publique o `.env` nem use as senhas de seed em produção.

## Produção e Docker

O `Dockerfile` gera uma imagem sem dependências de desenvolvimento e executa como usuário não-root:

```bash
docker build -t sistema-inventario-fablab .
docker run --rm -p 3000:3000 --env-file .env sistema-inventario-fablab
```

Aplique `npm run db:deploy` como etapa única de implantação antes de iniciar novas réplicas. O processo responde a `SIGTERM`/`SIGINT`, fecha o servidor e desconecta o Prisma.

Em bases com um histórico de empréstimos grande, aplique a migração `20261125000000_index_loan_history` em uma janela de manutenção. A criação dos índices bloqueia escritas na tabela `Loan` até o fim da migração.

A migração `20261125010000_index_active_loans_by_item` cria, de forma concorrente, um índice parcial para as consultas de empréstimos ativos e atrasados por item.

As migrações `20261125030000_index_active_loans_by_deadline` e `20261125040000_remove_superseded_active_deadline_index` substituem, de forma concorrente, o índice da fila geral de atrasos por um índice de prazo e ID. O novo índice fica disponível antes da remoção do anterior.

## Testes de integração

Use exclusivamente uma base descartável cujo nome contenha `test`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_test npm run db:deploy
RUN_DB_TESTS=true DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_test npm test
```

O workflow de CI provisiona essa base automaticamente e executa lint, migrações, tipos, testes, build e auditoria de dependências.
