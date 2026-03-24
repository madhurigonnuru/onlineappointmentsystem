const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const outboxPath = path.join(__dirname, "..", "data", "email-outbox.log");
let transporter;

const parseBoolean = (value) => String(value || "").trim().toLowerCase() === "true";

const getMailConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.EMAIL_FROM || user).trim();

  if (!host || !port || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    secure: parseBoolean(process.env.SMTP_SECURE),
    auth: {
      user,
      pass,
    },
    from,
  };
};

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: mailConfig.auth,
  });

  return transporter;
};

const writeToOutbox = (payload) => {
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
  fs.appendFileSync(outboxPath, `${JSON.stringify(payload)}\n`);
};

const queueNotification = async ({ roomCode, recipients, subject, message, type }) => {
  if (!recipients.length) {
    return;
  }

  const payload = {
    queuedAt: new Date().toISOString(),
    roomCode,
    type,
    recipients,
    subject,
    message,
  };

  const mailConfig = getMailConfig();
  const activeTransporter = getTransporter();

  if (!mailConfig || !activeTransporter) {
    writeToOutbox(payload);
    console.log(
      `Queued ${type} notification for ${recipients.length} recipient(s) in email-outbox.log`
    );
    return;
  }

  try {
    await activeTransporter.sendMail({
      from: mailConfig.from,
      to: recipients.join(", "),
      subject,
      text: message,
    });

    console.log(`Sent ${type} notification email to ${recipients.length} recipient(s)`);
  } catch (error) {
    writeToOutbox({
      ...payload,
      sendError: error.message,
    });
    console.error(`Failed to send ${type} email notification:`, error.message);
  }
};

module.exports = {
  queueNotification,
};
