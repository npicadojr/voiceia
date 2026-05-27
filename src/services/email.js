const { Resend } = require('resend');

let client = null;
function getClient() {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

async function sendBookingLink({ toEmail, toName, link, tenantName, fromEmail }) {
  const from = fromEmail || process.env.EMAIL_FROM || 'onboarding@resend.dev';
  const { error } = await getClient().emails.send({
    from,
    to: toEmail,
    subject: `Tu link para agendar cita${tenantName ? ` con ${tenantName}` : ''}`,
    html: `
      <p>Hola ${toName || ''},</p>
      <p>Haz clic en el siguiente link para elegir y confirmar tu cita:</p>
      <p><a href="${link}" style="background:#6c63ff;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Agendar mi cita</a></p>
      <p style="color:#888;font-size:12px">O copia este link: ${link}</p>
    `,
  });
  if (error) throw new Error(error.message);
}

module.exports = { sendBookingLink };
