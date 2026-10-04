// Every error looks the same: { error: { code, message, details? } }
export function sendError(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}
