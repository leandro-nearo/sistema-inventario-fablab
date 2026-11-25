# Referência da API — Frontend

URL base local: `http://localhost:3000`. Datas de resposta são strings ISO 8601.

## Autenticação

Envie o token de acesso como `Authorization: Bearer <accessToken>`. Tokens de refresh só são aceitos nos endpoints de refresh/logout.

| Método | Rota | Acesso | Corpo | Resposta |
|---|---|---|---|---|
| `POST` | `/auth/login` | Público | `{ email, password }` | `200` com tokens |
| `POST` | `/auth/refresh` | Público | `{ refreshToken }` | `200` com tokens rotacionados |
| `POST` | `/auth/logout` | Público | `{ refreshToken }` | `204` |
| `POST` | `/auth/logout-all` | Autenticado | — | `204` |
| `GET` | `/auth/me` | Autenticado | — | `200 { id, role }` |

Login e refresh possuem limite de 20 requisições por 15 minutos por endereço.

`GET /auth/me` retorna o papel atual da conta (`ADMIN` ou `OPERATOR`), inclusive se ele mudar durante a sessão.

## Erros

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Não foi possível encontrar um item com esse ID."
  }
}
```

Status usuais: `400` validação/JSON, `401` autenticação, `403` papel insuficiente, `404` recurso/rota, `409` conflito de estado ou unicidade, `429` limite de requisições e `500` falha inesperada.

Um corpo JSON que excede o limite configurado em `JSON_BODY_LIMIT` recebe `413` com o código `PAYLOAD_TOO_LARGE`. O limite padrão é 100 KB.

Um corpo JSON com codificação de caracteres ou de conteúdo não suportada recebe `415` com o código `UNSUPPORTED_MEDIA_TYPE`.

Campos de texto enviados ao banco e termos de busca com o caractere nulo `U+0000` recebem `400` com o código `VALIDATION_ERROR`.

## Paginação

Endpoints de lista aceitam `page` (padrão 1) e `pageSize` (padrão 50, máximo 100). A resposta continua sendo um array para manter compatibilidade.

Quando disponível, `search` busca um trecho literal sem distinguir maiúsculas de minúsculas. Os filtros de categoria e localização comparam o valor completo da mesma forma.

A lista de empréstimos e o histórico do cliente usam, por padrão, a data do empréstimo em ordem decrescente. O histórico de ajustes usa a data de criação em ordem decrescente. Em caso de empate nessas ordenações, o maior ID vem primeiro.

## Usuários

| Método | Rota | Papel | Corpo/consulta | Resposta |
|---|---|---|---|---|
| `POST` | `/user` | `ADMIN` | `username`, `email`, `password`, `passwordConfirm`, `role?` | `201 User` |
| `GET` | `/user` | `ADMIN` | `page`, `pageSize`, `search?` | `200 User[]` |
| `GET` | `/user/:id` | `ADMIN` | — | `200 User` |
| `PATCH` | `/user/:id` | `ADMIN` | `username?`, `email?`, `role?` | `200 User` |
| `DELETE` | `/user/:id` | `ADMIN` | — | `204` |
| `PATCH` | `/user/me/password` | Autenticado | `currentPassword`, `newPassword`, `passwordConfirm` | `204` |

A senha deve ter 12 ou mais caracteres e no máximo 72 bytes. Alterá-la revoga todos os refresh tokens do usuário. `role` aceita `ADMIN` ou `OPERATOR` e assume `OPERATOR` quando omitido. O último administrador não pode ser excluído nem rebaixado.

## Clientes

| Método | Rota | Papel | Corpo/consulta | Resposta |
|---|---|---|---|---|
| `POST` | `/client` | `ADMIN`, `OPERATOR` | `name`, `email`, `phone?` | `201 Client` |
| `GET` | `/client` | Autenticado | `page`, `pageSize`, `search?`, `email?` | `200 Client[]` |
| `GET` | `/client/:id` | Autenticado | — | `200 Client` |
| `GET` | `/client/:id/loans` | Autenticado | paginação | `200 Client` com `loans` |
| `PATCH` | `/client/:id` | `ADMIN`, `OPERATOR` | `name?`, `email?`, `phone?` | `200 Client` |
| `DELETE` | `/client/:id` | `ADMIN` | — | `204` |

`phone: null` remove o telefone. São aceitos de 8 a 15 dígitos; pontuação é removida. Clientes com histórico de empréstimos não podem ser apagados (`409`).

Em `GET /client`, `email` compara o endereço completo sem distinguir maiúsculas de minúsculas. Quando a consulta também inclui `search`, o cliente deve atender aos dois filtros.

## Itens

| Método | Rota | Papel | Corpo/consulta | Resposta |
|---|---|---|---|---|
| `POST` | `/item` | `ADMIN`, `OPERATOR` | `name`, `totalQuantity`, `location`, `category?` | `201 Item` |
| `GET` | `/item` | Autenticado | `page`, `pageSize`, `search?`, `availability?`, `order?` | `200 Item[]` |
| `GET` | `/item/by-category` | Autenticado | `category`, paginação | `200 Item[]` |
| `GET` | `/item/by-location` | Autenticado | `location`, paginação | `200 Item[]` |
| `GET` | `/item/:id` | Autenticado | — | `200 Item` |
| `GET` | `/item/:id/adjustments` | `ADMIN` | paginação | `200 InventoryAdjustment[]` |
| `PATCH` | `/item/:id` | `ADMIN`, `OPERATOR` | `name?`, `category?`, `totalQuantity?`, `expectedTotalQuantity?`, `adjustmentReason?`, `location?` | `200 Item` |
| `DELETE` | `/item/:id` | `ADMIN` | — | `204` |

Em `GET /item`, `availability=available` seleciona itens com quantidade disponível maior que zero. `availability=unavailable` seleciona itens com quantidade disponível zero, inclusive quando todas as unidades estão emprestadas. Omita `availability` para incluir todos os itens.

Use `order=desc` para listar os itens do maior para o menor ID. A API usa `order=asc` por padrão. A tela de estoque abre em ordem decrescente por ID.

`totalQuantity` é inteiro e não-negativo. `availableQuantity` é calculado pelo servidor. Alterar `totalQuantity` exige `adjustmentReason` (3–200 caracteres) e gera uma entrada de auditoria. `category: null` remove a categoria. A quantidade total não pode ficar abaixo das unidades atualmente emprestadas. Itens com histórico ou ajustes não podem ser apagados (`409`).

Ao enviar `totalQuantity`, inclua a quantidade total que você consultou em `expectedTotalQuantity` para proteger a alteração contra ajustes simultâneos. Se o valor informado divergir do total gravado, a API retorna `409` com `ITEM_QUANTITY_CHANGED` e rejeita a atualização inteira.

## Empréstimos

| Método | Rota | Papel | Corpo/consulta | Resposta |
|---|---|---|---|---|
| `POST` | `/loan` | `ADMIN`, `OPERATOR` | `clientId`, `itemId`, `loanDate`, `dueDate`, `loanQuantity`, `returnDate?`; cabeçalho opcional `Idempotency-Key` | `201 Loan` na criação, `200 Loan` na repetição |
| `GET` | `/loan` | Autenticado | paginação, `status?`, `itemId?`, `clientId?`, `include?`, `order?` | `200 LoanListEntry[]` |
| `GET` | `/loan/:id` | Autenticado | — | `200 Loan` |
| `POST` | `/loan/:id/return` | `ADMIN`, `OPERATOR` | `expectedUpdatedAt?` | `200 Loan` |
| `POST` | `/loan/:id/renew` | `ADMIN`, `OPERATOR` | `expectedUpdatedAt`, `dueDate` | `200 Loan` |
| `PATCH` | `/loan/:id` | `ADMIN`, `OPERATOR` | `loanDate?`, `dueDate?`, `returnDate?` | `200 Loan` |
| `DELETE` | `/loan/:id` | `ADMIN` | `expectedUpdatedAt?` | `204` |

`status` aceita `all`, `active`, `returned`, `cancelled` e `overdue`. Definir `returnDate` devolve o estoque; definir `returnDate: null` reabre o empréstimo se houver estoque. `DELETE` cancela e preserva o registro.

Use `GET /loan?itemId=42&status=active` para listar empréstimos ativos do item 42. Use `GET /loan?clientId=12&status=active&include=itemLocation` para listar os empréstimos ativos do cliente 12 com nome e localização dos itens. É possível combinar os filtros de cliente, item e situação. A consulta retorna uma lista vazia quando nenhum empréstimo corresponde aos filtros.

Use `include=client` para acrescentar `client: { name }`, `include=item` para `item: { name }` ou `include=itemLocation` para `item: { name, location }`. Combine `client` com uma das opções de item por meio de uma vírgula. Os campos `clientId` e `itemId` identificam os registros relacionados.

`order=recent` é o padrão e ordena pela data do empréstimo, da mais nova à mais antiga, com maior ID primeiro em caso de empate. `order=due` mostra os vencimentos mais antigos primeiro. Em caso de empate no vencimento, o menor ID vem primeiro. Para consultar os atrasos de todo o estoque, use `GET /loan?status=overdue&include=client,itemLocation&order=due`.

Ao criar um empréstimo, envie um UUID novo em `Idempotency-Key` e mantenha a mesma chave e os mesmos dados se precisar reenviar. A repetição pela mesma conta retorna o estado atual do empréstimo já criado. Usar a chave com outros dados válidos retorna `409 IDEMPOTENCY_KEY_CONFLICT`. Uma tentativa rejeitada antes da criação permite reutilizar a chave.

`POST /loan/:id/return` registra a devolução com a data e hora do servidor. Se o empréstimo já foi devolvido, retorna o registro com a data e a conta responsável originais. Um empréstimo cancelado retorna `409 LOAN_CANCELLED`. Se a data do empréstimo ainda estiver no futuro, retorna `400 INVALID_LOAN_DATES`.

Ao devolver, envie o `updatedAt` que recebeu na consulta no parâmetro de consulta `expectedUpdatedAt`. Se um empréstimo ativo estiver em outra versão, a API retorna `409 LOAN_CHANGED` e preserva o saldo.

`POST /loan/:id/renew` prorroga o prazo sem alterar o saldo. Envie o `updatedAt` que recebeu na consulta em `expectedUpdatedAt` e um novo prazo futuro em `dueDate`. O novo prazo deve ser posterior ao atual. Se uma versão mais recente do empréstimo ainda estiver ativa e já tiver o prazo solicitado, a API retorna esse registro. Uma versão mais recente com outro prazo retorna `409 LOAN_CHANGED`. Empréstimos devolvidos ou cancelados retornam `409 LOAN_RETURNED` ou `409 LOAN_CANCELLED`.

Consultar, alterar, renovar, devolver ou cancelar um empréstimo inexistente retorna `404` com o código `LOAN_NOT_FOUND`.

Ao cancelar, envie o `updatedAt` que recebeu na consulta em `expectedUpdatedAt` para exigir aquela versão. Uma versão diferente retorna `409 LOAN_CHANGED`. Repetir o cancelamento de um empréstimo já cancelado retorna `204` e preserva o registro de cancelamento.

Datas aceitam `YYYY-MM-DD` ou data e hora ISO com segundos e fuso, por exemplo `2026-09-04T10:00:00-03:00`. `dueDate` e `returnDate` não podem anteceder `loanDate`.

## Modelos resumidos

```ts
type User = {
  id: number; email: string; username: string; role: "ADMIN" | "OPERATOR";
  createdAt: string; updatedAt: string;
};

type Client = {
  id: number; name: string; email: string; phone: string | null;
  createdAt: string; updatedAt: string;
};

type Item = {
  id: number; name: string; category: string | null; location: string;
  totalQuantity: number; availableQuantity: number;
  createdAt: string; updatedAt: string;
};

type Loan = {
  id: number; clientId: number; itemId: number; loanQuantity: number;
  loanDate: string; dueDate: string; returnDate: string | null;
  cancelledAt: string | null;
  createdById: number | null; returnedById: number | null; cancelledById: number | null;
  createdAt: string; updatedAt: string;
};

type LoanListEntry = Loan & { client?: { name: string }; item?: { name: string; location?: string } };
```

## Saúde

- `GET /health/live`: processo HTTP ativo.
- `GET /health/ready`: retorna `200` quando a consulta ao PostgreSQL funciona e `503` com o código `DATABASE_UNAVAILABLE` quando a consulta falha.

Consulte [openapi.yaml](./openapi.yaml) para a especificação legível por ferramentas.
