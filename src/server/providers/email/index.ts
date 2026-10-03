import { prisma } from '@/lib/prisma';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  organizationId?: string;
  templateKey?: string;
}

export interface EmailProvider {
  send(m: EmailMessage): Promise<{ id: string }>;
}

/**
 * Provider mock (CDC : « mode mock clairement identifié »).
 * Les messages sont journalisés dans MessageLog et visibles sur la
 * page « Boîte d'envoi (démo) ». En production : SMTP/Resend/SES.
 */
export const emailProvider: EmailProvider = {
  async send(m: EmailMessage) {
    const log = await prisma.messageLog.create({
      data: {
        organizationId: m.organizationId ?? null,
        channel: 'email',
        recipient: m.to,
        templateKey: m.templateKey ?? null,
        subject: m.subject,
        body: m.text,
        status: 'sent',
        provider: 'mock',
      },
    });
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[email:mock] → ${m.to} | ${m.subject}`);
    }
    return { id: log.id };
  },
};

/** Rendu d'un template de notification avec variables {{…}}. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{?(\w+)\}?\}/g, (_, k: string) =>
    k in vars ? vars[k] : `{{${k}}}`,
  );
}

/** Charge un template plateforme/organisation (fallback plateforme). */
export async function getTemplate(
  key: string,
  channel: string,
  organizationId?: string,
  locale: 'fr' | 'en' = 'fr',
): Promise<{ subject: string; body: string } | null> {
  const found =
    (organizationId
      ? await prisma.notificationTemplate.findFirst({
          where: { organizationId, key, channel, active: true },
        })
      : null) ??
    (await prisma.notificationTemplate.findFirst({
      where: { organizationId: null, key, channel, active: true },
    }));
  if (!found) return null;
  return {
    subject: locale === 'en' ? found.subjectEn ?? '' : found.subjectFr ?? '',
    body: locale === 'en' ? found.bodyEn : found.bodyFr,
  };
}
