# Custom services

Custom services let an `fws` user define a stateful HTTP mock without adding
service-specific code to `fws`. Declarative routes cannot execute code or
access the host filesystem. Optional Python handlers are trusted local code
and have the daemon user's filesystem permissions.

Register a definition against a running server:

```bash
fws service register bank.json
curl --proxy http://localhost:4101 --cacert ~/.local/share/fws/certs/ca.crt \
  https://bank.test/balance
fws service state bank.test
fws service requests bank.test
```

Example `bank.json`:

```json
{
  "host": "bank.test",
  "state": {
    "balance": 1000,
    "transfers": []
  },
  "routes": [
    {
      "method": "GET",
      "path": "/balance",
      "response": {
        "body": { "balance": "$state.balance" }
      }
    },
    {
      "method": "POST",
      "path": "/accounts/:account/transfers",
      "transitions": [
        {
          "op": "append",
          "path": "transfers",
          "value": "$request.body"
        },
        {
          "op": "increment",
          "path": "balance",
          "value": "$request.body.amount",
          "multiplier": -1
        }
      ],
      "response": {
        "status": 201,
        "body": {
          "account": "$request.params.account",
          "balance": "$state.balance"
        }
      }
    }
  ]
}
```

## Expressions

A value that consists entirely of an expression preserves the referenced JSON
type:

- `$state.balance`
- `$request.body.amount`
- `$request.params.account`
- `$request.query.currency`
- `$request.headers.authorization`

Expressions can be embedded in strings with `{{...}}`, such as
`"transfer to {{$request.body.recipient}}"`.

## State transitions

Routes apply transitions in order before rendering the response:

| Operation | Behavior |
|---|---|
| `set` | Set a state path, creating intermediate objects |
| `append` | Append to an existing array |
| `increment` | Add a numeric value, optionally scaled by `multiplier` |
| `delete` | Delete a state path |

Custom-service definitions, state, and request logs are included in normal
`fws snapshot save` and `fws snapshot load` operations. Reserved service hosts
cannot be overridden.

## Python handlers

For behavior that is awkward to express as state transitions, a service can
delegate each request to a trusted Python script:

```json
{
  "host": "slack.test",
  "state": { "messages": [] },
  "handler": {
    "type": "python",
    "script": "./slack_handler.py",
    "timeoutMs": 5000
  }
}
```

`fws service register` resolves the script relative to the service-definition
file. The daemon starts `python3` for each request (override with
`FWS_PYTHON`), writes this JSON to stdin:

```json
{
  "state": {},
  "request": {
    "method": "POST",
    "path": "/channels/general/messages",
    "params": {},
    "query": {},
    "headers": {},
    "body": {}
  }
}
```

The script must write exactly one JSON object to stdout:

```json
{
  "state": {},
  "response": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": {}
  }
}
```

The returned state becomes the service state and is included in snapshots.
Request logs remain owned by `fws`. The script itself stays outside `fws`;
snapshots retain only its absolute path.

Python handlers execute trusted local code with the daemon user's permissions.
By default scripts must live under `FWS_DATA_DIR` or the directory where the
daemon was started. Set `FWS_HANDLER_ROOTS` to a platform-delimited list of
additional trusted directories. Handler requests are serialized per service,
so concurrent writes cannot overwrite each other's state. Use declarative
routes when arbitrary code is unnecessary.

Installed packages can use a module instead of a script path:

```json
{
  "handler": {
    "type": "python",
    "module": "my_package.fws_handler"
  }
}
```

Module handlers run as `python3 -m my_package.fws_handler`, avoiding import
shadowing that can occur when a package-internal file is executed directly.
