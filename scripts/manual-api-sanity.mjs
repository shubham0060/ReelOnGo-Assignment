const baseUrl = "http://localhost:3000";

const results = [];

function addResult(check, pass, details) {
  results.push({ check, status: pass ? "PASS" : "FAIL", details });
}

function parseCookie(setCookieHeader) {
  if (!setCookieHeader) return "";
  const match = setCookieHeader.match(/connect_token=[^;]+/i);
  return match ? match[0] : "";
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { response, text, json };
}

async function main() {
  const home = await fetch(baseUrl);
  addResult("Server Reachable", home.ok, `HTTP ${home.status}`);

  const email = `sanity.${Date.now()}@example.com`;
  const password = "Pass@123";
  const displayName = "SanityUser";

  let authCookie = "";
  let loggedInUserId = "";
  let targetUserId = "";
  let createdMessageId = "";

  {
    const { response, json, text } = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });

    authCookie = parseCookie(response.headers.get("set-cookie"));
    const pass = response.ok && Boolean(json?.user?.id) && Boolean(authCookie);
    addResult("Register API", pass, pass ? `userId=${json.user.id}` : text.slice(0, 180));
  }

  {
    const { response, json, text } = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const loginCookie = parseCookie(response.headers.get("set-cookie"));
    if (loginCookie) authCookie = loginCookie;
    loggedInUserId = json?.user?.id ?? "";
    const pass = response.ok && Boolean(loggedInUserId) && Boolean(authCookie);
    addResult("Login API", pass, pass ? `userId=${loggedInUserId}` : text.slice(0, 180));
  }

  {
    const { response, json, text } = await request("/api/users?query=bob", {
      headers: { Cookie: authCookie },
    });

    const list = Array.isArray(json?.users) ? json.users : [];
    const bob = list.find((user) => user.email === "bob.connect@example.com") ?? list[0];
    targetUserId = bob?.id ?? "";
    const pass = response.ok && Boolean(targetUserId);
    addResult("Users Discovery API", pass, pass ? `targetUserId=${targetUserId}` : text.slice(0, 180));
  }

  {
    const payloadText = `manual-api-sanity-${Date.now()}`;
    const { response, json, text } = await request("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
      },
      body: JSON.stringify({ toUserId: targetUserId, text: payloadText }),
    });

    createdMessageId = json?.message?.id ?? "";
    const pass = response.ok && Boolean(createdMessageId);
    addResult("Send Message API", pass, pass ? `messageId=${createdMessageId}` : text.slice(0, 180));
  }

  {
    const { response, json, text } = await request(`/api/messages?userId=${targetUserId}`, {
      headers: { Cookie: authCookie },
    });

    const list = Array.isArray(json?.messages) ? json.messages : [];
    const found = list.some((message) => message.id === createdMessageId);
    const pass = response.ok && found;
    addResult("Fetch Messages API", pass, pass ? `messagesReturned=${list.length}` : text.slice(0, 180));
  }

  console.table(results);

  const hasFail = results.some((item) => item.status === "FAIL");
  console.log(`API_SANITY_EXIT:${hasFail ? 1 : 0}`);

  process.exit(hasFail ? 1 : 0);
}

main().catch((error) => {
  console.error("API sanity script failed", error);
  process.exit(1);
});
