import { HEADER } from "@edgway/constants";

export const handle = (
  upstream: { fetch(r: Request): Promise<Response> },
  req: Request,
) => upstream.fetch(new Request(req, { headers: { [HEADER.route]: "r1" } }));
