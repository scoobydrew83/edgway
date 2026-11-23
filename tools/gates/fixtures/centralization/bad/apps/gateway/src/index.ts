export const handle = (req: Request) =>
  fetch(new Request(req, { headers: { "x-edgway-route": "r1" } }));
