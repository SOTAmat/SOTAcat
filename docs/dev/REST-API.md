# REST API

SOTAcat's HTTP interface is described by one OpenAPI 3.1 document:

- Source: [`openapi-v1.yaml`](openapi-v1.yaml) in this directory
- Rendered: <https://sotamat.github.io/SOTAcat/api/>

The rendered page is a Redoc viewer over the same file, redeployed by GitHub
Pages whenever the YAML changes. Everything a client needs is in the YAML:
every route, its query parameters or JSON body, the exact status codes the
firmware returns and what each means, and the body shape for each. The
introduction at the top covers the conventions that are easy to get wrong:
bare-text replies, the 204/202/500/503 meanings of a radio write, and the
`Content-Type` the firmware actually sends on errors.

## Importing into a client

- **Postman**: *Import*, paste the raw URL
  `https://raw.githubusercontent.com/SOTAmat/SOTAcat/main/docs/dev/openapi-v1.yaml`,
  and set the `host` collection variable to your device's address.
- **Swagger UI, Insomnia, code generators**: point them at the same URL or
  the local file. The server URL is `http://{host}/api/v1` with `host`
  defaulting to `sotacat.local`.

Import of this file into Postman has not been exercised by the maintainers;
the file validates as OpenAPI 3.1 (`openapi-spec-validator`) and renders in
Redoc, which is what has been checked.

## Keeping it true

The YAML is held to the firmware by `test/integration/test_api_contract.py`,
which:

1. Parses the route table in `src/webserver.cpp` and fails if the YAML's
   route set differs from it in either direction.
2. Requires a probe for every operation in the YAML, and a YAML entry for
   every probe.
3. Sends each probe and checks the reply's status is one the YAML declares
   for that operation, and that the body matches the declared schema.

```bash
make -C test/integration test-api-contract-mock   # against the mock, all probes
make -C test/integration test-api-contract        # against HOST; TX and reboot probes skipped
```

Against hardware, add `--allow-tx` to run the keyer, message, ATU, and FT8
probes and `--allow-reboot` to run reboot, OTA, and the Wi-Fi settings POST.
The mock run proves the document and the mock agree; only a hardware run
proves the document and the firmware agree.

When you add or change a route:

1. Edit the handler and the route table.
2. Edit `openapi-v1.yaml` to match, including every status the handler can
   return.
3. Add or adjust a probe in `test_api_contract.py`, and teach the mock in
   `test/mock_server/server.py` the same behavior.
4. Run `.venv/bin/openapi-spec-validator docs/dev/openapi-v1.yaml` and the
   mock contract test.

## What the document does not cover

- The rigctld (Hamlib NET rigctl) interface on TCP 4532. See
  [Rig Control Apps](../user/Rig-Control-Apps.md) and `src/rigctld_server.cpp`.
- Timing bounds in detail. `test_radio_contract.py` asserts those; the
  design is in
  [`superpowers/specs/2026-08-17-radio-async-handlers-design.md`](../superpowers/specs/2026-08-17-radio-async-handlers-design.md).
- A proposed v2 of the API, which would add a state document, operations
  with outcomes, and an event stream. That is a design only; see
  [`superpowers/specs/2026-09-06-client-api-v2-design.md`](../superpowers/specs/2026-09-06-client-api-v2-design.md).
  v1 as documented here is frozen by that design.
