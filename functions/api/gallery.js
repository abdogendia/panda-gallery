export async function onRequestGet(context) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${context.env.JSONBIN_BIN_ID}/latest`, {
    headers: { "X-Master-Key": context.env.JSONBIN_API_KEY }
  });
  const data = await res.json();
  return Response.json(data.record);
}

export async function onRequestPut(context) {
  const body = await context.request.json();
  const res = await fetch(`https://api.jsonbin.io/v3/b/${context.env.JSONBIN_BIN_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": context.env.JSONBIN_API_KEY
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return Response.json(data);
}
