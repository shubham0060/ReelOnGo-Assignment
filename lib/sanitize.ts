import sanitizeHtml from "sanitize-html";

function sanitizePlainText(input: string) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}

export function sanitizeMessage(input: string) {
  return sanitizePlainText(input).slice(0, 2000);
}

export function sanitizeProfileText(input: string) {
  return sanitizePlainText(input).slice(0, 140);
}

export function sanitizeAvatarUrl(input: string) {
  const value = String(input ?? "").trim().slice(0, 12000);

  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+$/i.test(value)) {
    return value;
  }

  return "";
}
