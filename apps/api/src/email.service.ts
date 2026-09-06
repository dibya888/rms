import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendPasswordReset(email: string, token: string) {
    await this.sendAccountEmail(email, token, 'reset');
  }

  async sendActivationEmail(email: string, token: string) {
    await this.sendAccountEmail(email, token, 'activation');
  }

  private async sendAccountEmail(email: string, token: string, kind: 'reset' | 'activation') {
    const microsoftConfiguration = {
      tenantId: process.env.MICROSOFT_TENANT_ID,
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      senderEmail: process.env.MICROSOFT_SENDER_EMAIL,
      frontendUrl: process.env.FRONTEND_URL,
    };
    const configuredValues = Object.values(microsoftConfiguration);
    if (configuredValues.some(Boolean)) {
      if (configuredValues.some((value) => !value)) throw new Error('Microsoft Graph password-reset email configuration is incomplete');
      const { tenantId, clientId, clientSecret, senderEmail, frontendUrl } = microsoftConfiguration;
      if (!tenantId || !clientId || !clientSecret || !senderEmail || !frontendUrl) throw new Error('Microsoft Graph password-reset email configuration is incomplete');
      await this.sendThroughMicrosoftGraph(email, token, { tenantId, clientId, clientSecret, senderEmail, frontendUrl }, kind);
      return;
    }

    if (process.env.NODE_ENV === 'production') throw new Error('Microsoft Graph password-reset email configuration is required in production');
    const sinkPath = process.env.EMAIL_SINK_PATH;
    if (!sinkPath) {
      this.logger.log(`${kind === 'activation' ? 'Account activation' : 'Password reset'} requested for ${email}`);
      return;
    }
    const filePath = resolve(sinkPath);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${new Date().toISOString()} ${kind} ${email} ${token}\n`, 'utf8');
  }

  private async sendThroughMicrosoftGraph(email: string, token: string, configuration: { tenantId: string; clientId: string; clientSecret: string; senderEmail: string; frontendUrl: string }, kind: 'reset' | 'activation' = 'reset') {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Microsoft identity token request failed with HTTP ${tokenResponse.status}`);
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    if (!tokenBody.access_token) throw new Error('Microsoft identity token response did not contain an access token');

    const path = kind === 'activation' ? 'activate' : 'reset-password';
    const action = kind === 'activation' ? 'Activate account' : 'Reset password';
    const subject = kind === 'activation' ? 'Activate your RMS account' : 'Reset your RMS password';
    const actionUrl = new URL(`${path}?token=${encodeURIComponent(token)}`, `${configuration.frontendUrl.replace(/\/$/, '')}/`).toString();
    const escapedEmail = this.escapeHtml(email);
    const escapedActionUrl = this.escapeHtml(actionUrl);
    const heading = kind === 'activation' ? 'Activate your RMS account' : 'Password reset';
    const instruction = kind === 'activation' ? 'Confirm your email address to activate your account.' : 'A password reset was requested for your account.';
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#18211f"><h2>${heading}</h2><p>${instruction}</p><p>This link expires in 1 hour.</p><p><a href="${escapedActionUrl}" style="display:inline-block;padding:12px 18px;background:#315b47;color:#ffffff;text-decoration:none">${action}</a></p><p>Or copy this URL into your browser:<br><a href="${escapedActionUrl}">${escapedActionUrl}</a></p><p>Address: ${escapedEmail}</p></div>`;
    const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(configuration.senderEmail)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: email } }],
        },
        saveToSentItems: false,
      }),
    });
    if (!graphResponse.ok) throw new Error(`Microsoft Graph sendMail failed with HTTP ${graphResponse.status}`);
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
  }
}
