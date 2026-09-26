/**
 * Transactional email delivery (password-reset codes).
 *
 * Provider selection is environment-driven so no email vendor is hard-wired:
 *   - `EMAIL_PROVIDER=RESEND` + `EMAIL_API_KEY` + `EMAIL_FROM` → sent through the Resend
 *     HTTP API.
 *   - Not configured, outside production → the message is printed to the server log so
 *     the reset flow can be exercised locally.
 *   - Not configured, in production → delivery fails (returns `false`) and `/api/health`
 *     reports `passwordResetEmail: false` so the gap is visible before launch.
 */

export interface OutgoingEmail {
    to: string;
    subject: string;
    text: string;
}

export function emailDeliveryConfigured(): boolean {
    return (
        process.env.EMAIL_PROVIDER?.trim().toUpperCase() === 'RESEND' &&
        Boolean(process.env.EMAIL_API_KEY?.trim()) &&
        Boolean(process.env.EMAIL_FROM?.trim())
    );
}

/** Deliver an email. Resolves `true` when accepted by the provider (or logged in dev). */
export async function sendEmail(message: OutgoingEmail): Promise<boolean> {
    if (!emailDeliveryConfigured()) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[mail] EMAIL_PROVIDER is not configured; email to %s was not sent.', message.to);
            return false;
        }
        console.info('[mail:dev] To: %s | %s\n%s', message.to, message.subject, message.text);
        return true;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.EMAIL_API_KEY!.trim()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM!.trim(),
                to: [message.to],
                subject: message.subject,
                text: message.text,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) console.error('[mail] Provider rejected email (HTTP %d).', response.status);
        return response.ok;
    } catch (error) {
        console.error('[mail] Email delivery failed:', error instanceof Error ? error.message : error);
        return false;
    }
}
