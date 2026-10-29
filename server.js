// DalaChain веб-сервері
const express = require("express");
const path = require("path");
const { Blockchain, sha256, txId } = require("./blockchain");

const app = express();
const bc = new Blockchain();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// қателерді бір форматта қайтару
const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const withIds = (b) => ({ ...b, transactions: b.transactions.map((t) => ({ ...t, id: txId(t) })) });

app.get("/api/stats", handle(() => bc.stats()));
app.get("/api/chain", handle(() => bc.chain.map(withIds)));
app.get("/api/pending", handle(() => bc.pending.map((t) => ({ ...t, id: txId(t) }))));
app.get("/api/wallets", handle(() => Object.entries(bc.wallets).map(([address, w]) => ({
  address, name: w.name, ...bc.balance(address),
}))));
app.get("/api/wallet/:address", handle((req) => {
  const w = bc.wallets[req.params.address];
  if (!w) throw new Error("Әмиян табылмады");
  return { address: req.params.address, name: w.name, ...bc.balance(req.params.address), history: bc.history(req.params.address) };
}));
app.post("/api/wallet", handle((req) => bc.createWallet(req.body.name)));
app.post("/api/transaction", handle((req) => bc.addTransaction(req.body)));
app.post("/api/mine", handle((req) => {
  const r = bc.mine(req.body.miner);
  return { block: withIds(r.block), attempts: r.attempts, ms: r.ms };
}));
app.get("/api/validate", handle(() => bc.validate()));
app.post("/api/tamper", handle((req) => bc.tamper(Number(req.body.block), Number(req.body.tx), req.body.amount)));
app.post("/api/remine", handle((req) => bc.remineFrom(Number(req.body.from))));
app.post("/api/restore", handle(() => bc.restore()));
app.get("/api/hash", handle((req) => ({ text: req.query.text || "", hash: sha256(req.query.text || "") })));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DalaChain іске қосылды: http://localhost:${PORT}`));
