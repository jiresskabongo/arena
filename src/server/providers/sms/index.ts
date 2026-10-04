import { prisma } from '@/lib/prisma';

export interface SmsMessage {
  to: string; // téléphone international
  text: string;
  organizationId?: string;
  templateKey?: string;
  guestId?: string;
  campaignId?: string;
  channel?: 'sms' | 'whatsapp';
}

/**
 * Provider SMS/WhatsApp mock (CDC : « mode mock clairement identifié »).
 * - SMS : journalisé dans MessageLog (channel 'sms') + page « Boîte d'envoi (démo) ».
 * - WhatsApp : API officielle uniquement en prod (Twilio/Meta) ; en sandbox le
 *   canal 'whatsapp' est aussi mock et clairement identifié (réserve §13).
 * En production : Twilio / Meta Cloud API.
 */
export const smsProvider = {
  async send(m: SmsMessage): Promise<{ id: string }> {
    const log = await prisma.messageLog.create({
      data: {
        organizationId: m.organizationId ?? null,
        campaignId: m.campaignId ?? null,
        guestId: m.guestId ?? null,
        channel: m.channel ?? 'sms',
        recipient: m.to,
        templateKey: m.templateKey ?? null,
        body: m.text,
        status: 'sent',
        provider: 'mock',
      },
    });
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[${(m.channel ?? 'sms')}:mock] → ${m.to} | ${m.text.slice(0, 80)}`);
    }
    return { id: log.id };
  },
};
