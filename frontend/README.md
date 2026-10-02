# Botfight frontend

Botfight now submits deterministic melee bot brains. Players author priority
logic blocks in the arena UI, check the rules, and submit the normalized logic
configuration to the backend. Clean Play and rated fights evaluate those blocks
directly; there is no browser TensorFlow model, generated dataset, loss curve,
or base-model artifact in the active flow.

```bash
npm run dev
npm test
npm run lint
npm run build
```
