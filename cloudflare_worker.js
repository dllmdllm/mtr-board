export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");
    if (!target) {
      return new Response("missing target", { status: 400 });
    }
    const allow = [
      "https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json",
      "https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeV.json"
    ];
    if (!allow.includes(target)) {
      return new Response("blocked target", { status: 403 });
    }
    const resp = await fetch(target, { headers: { "User-Agent": "mtr-board" } });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "*",
        "cache-control": "max-age=30"
      }
    });
  }
};
