// EDIT THESE TWO LINES: your email and name, her email and name.
const USERS = {
  "dogslovegucci@proton.me": "Fabian",
  "williams_dianaw@icloud.com": "Ana",
};

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

export async function onRequest({ request, env }) {
  const email = (request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
  const me = USERS[email];
  if (!me) return json({ error: "forbidden" }, 403);
  const other = Object.keys(USERS).find((e) => e !== email);
  const db = env.DB;
  const clean = (s, n) => String(s || "").trim().slice(0, n);
  const link = (s) => (/^https?:\/\//i.test(clean(s, 500)) ? clean(s, 500) : "");

  if (request.method === "GET") {
    const q = (cols, o) => db.prepare(`SELECT ${cols} FROM items WHERE owner=? ORDER BY id DESC`).bind(o).all();
    const mine = (await q("id,title,link,note,price", email)).results;
    const theirs = (await q("id,title,link,note,price,claimed", other)).results;
    return json({ me, partner: USERS[other], mine, theirs });
  }

  const b = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  if (request.method === "POST") {
    const title = clean(b.title, 200);
    if (!title) return json({ error: "title required" }, 400);
    await db.prepare("INSERT INTO items (owner,title,link,note,price) VALUES (?,?,?,?,?)")
      .bind(email, title, link(b.link), clean(b.note, 1000), clean(b.price, 50)).run();
    return json({ ok: true });
  }
  if (request.method === "PUT") {
    if (b.claimed !== undefined) {
      await db.prepare("UPDATE items SET claimed=? WHERE id=? AND owner=?")
        .bind(b.claimed ? 1 : 0, b.id, other).run();
    } else {
      const title = clean(b.title, 200);
      if (!title) return json({ error: "title required" }, 400);
      await db.prepare("UPDATE items SET title=?,link=?,note=?,price=? WHERE id=? AND owner=?")
        .bind(title, link(b.link), clean(b.note, 1000), clean(b.price, 50), b.id, email).run();
    }
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM items WHERE id=? AND owner=?")
      .bind(new URL(request.url).searchParams.get("id"), email).run();
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}
