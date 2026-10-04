import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { ScannerAppClient, type ScannerInit } from '@/components/scanner/scanner-app';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contrôle d’accès — EventFlow',
  robots: { index: false },
};

/**
 * App de scan (agent). Aucun login requis : le token d'agent opaque est la
 * credential (liée à UN événement). 404 générique si inconnu/désactivé.
 */
export default async function ScannerPage({
  params,
}: {
  params: Promise<{ locale: string; agentToken: string }>;
}) {
  const { locale, agentToken } = await params;
  setRequestLocale(locale);

  if (!/^[0-9A-Za-z]{16,80}$/.test(agentToken)) notFound();
  const agent = await prisma.scannerAgent.findUnique({
    where: { token: agentToken },
    include: { event: true },
  });
  if (!agent || !agent.active) notFound();
  const { event } = agent;

  let permissions: { canViewPhoto: boolean; canSearch: boolean; canSeeHistory: boolean } =
    { canViewPhoto: false, canSearch: false, canSeeHistory: false };
  try {
    permissions = JSON.parse(agent.permissionsJson) as typeof permissions;
  } catch {
    /* défauts fermés */
  }

  const init: ScannerInit = {
    agentToken,
    agent: {
      id: agent.id,
      name: agent.name,
      entryPoint: agent.entryPoint,
      permissions,
    },
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      allowMultipleEntries: event.allowMultipleEntries,
      welcomeMessage: event.welcomeMessage,
      date: event.date.toISOString(),
      startTime: event.startTime,
      endTime: event.endTime,
      venue: event.venue,
    },
  };

  return <ScannerAppClient locale={locale} init={init} />;
}
