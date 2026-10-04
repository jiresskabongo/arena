import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getPublicInvitation } from '@/server/services/invitation';
import { RsvpInvitationClient } from '@/components/public/rsvp-invitation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await getPublicInvitation(token);
  return {
    title: view ? `Invitation — ${view.invitation.event.name}` : 'Invitation — EventFlow',
    description: 'Invitation personnalisée avec RSVP et QR code unique.',
    robots: { index: false },
  };
}

export default async function PublicInvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  // Anti-énumération : même 404 qu'une URL inconnue (pas d'info leak)
  if (!/^[0-9A-Za-z]{16,80}$/.test(token)) notFound();

  const view = await getPublicInvitation(token);
  if (!view) notFound();

  return (
    <RsvpInvitationClient
      locale={locale}
      token={token}
      invitation={{
        publicUrl: view.invitation.publicUrl,
        guest: view.invitation.guest,
        rsvpEnabled: view.invitation.rsvpEnabled,
        rsvpClosed: view.invitation.rsvpClosed,
        qrData: view.invitation.qrData,
        rsvp: view.invitation.rsvp,
        questions: view.invitation.questions,
      }}
      event={{
        ...view.invitation.event,
        date: view.invitation.event.date.toISOString(),
      }}
    />
  );
}
