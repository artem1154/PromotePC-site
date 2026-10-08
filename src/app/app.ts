import { Component, OnDestroy, signal } from '@angular/core';
import * as QRCode from 'qrcode';

interface AgentPackage {
  id: string;
  qr: string;
  url: string;
  filename: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<AgentPackage | null>(null);

  private readonly downloadUrl =
    'https://vqgbf86r-5034.euw.devtunnels.ms/api/download-agent';

  private request?: AbortController;

  async downloadAgent(): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    const request = new AbortController();
    this.request = request;

    try {
      // Отримуємо готовий архів від бекенду.
      const response = await fetch(this.downloadUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/zip'
        },
        signal: request.signal,
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(
          `Не вдалося завантажити агента (HTTP ${response.status}). Спробуйте пізніше.`
        );
      }

      const contentType = response.headers
        .get('Content-Type')
        ?.split(';')[0]
        .trim()
        .toLowerCase();

      if (contentType !== 'application/zip') {
        throw new Error(
          'Сервер повернув не ZIP-архів. Спробуйте пізніше.'
        );
      }

      // ID беремо з тієї самої відповіді, що й архів.
      const id = response.headers.get('X-Agent-Id')?.trim();

      if (!id) {
        throw new Error(
          'Не вдалося отримати ID агента від сервера.'
        );
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error('Сервер повернув порожній файл агента.');
      }

      // QR містить саме ID, отриманий від бекенду.
      const qr = await QRCode.toDataURL(id, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'M'
      });

      if (request.signal.aborted) return;

      const previous = this.result();

      const ready: AgentPackage = {
        id,
        qr,
        url: URL.createObjectURL(blob),
        filename: 'RemoteMonitorAgent.zip'
      };

      this.result.set(ready);

      if (previous) {
        URL.revokeObjectURL(previous.url);
      }

      // Запускаємо завантаження отриманого архіву.
      const link = document.createElement('a');
      link.href = ready.url;
      link.download = ready.filename;

      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      if (!request.signal.aborted) {
        this.error.set(
          error instanceof TypeError
            ? 'Не вдалося з’єднатися із сервером. Перевірте з’єднання та спробуйте ще раз.'
            : error instanceof Error
              ? error.message
              : 'Не вдалося підготувати агента.'
        );
      }
    } finally {
      this.busy.set(false);
      this.request = undefined;
    }
  }

  ngOnDestroy(): void {
    this.request?.abort();

    const ready = this.result();

    if (ready) {
      URL.revokeObjectURL(ready.url);
    }
  }
}