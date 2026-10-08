import { Component, OnDestroy, signal } from '@angular/core';
import JSZip from 'jszip';
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

    // Прибираємо попередній QR перед новим завантаженням.
    const previous = this.result();
    this.result.set(null);

    if (previous) {
      URL.revokeObjectURL(previous.url);
    }

    const request = new AbortController();
    this.request = request;

    try {
      // Один запит повертає і архів, і заголовки.
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
          `Не вдалося завантажити агента (HTTP ${response.status}).`
        );
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error('Сервер повернув порожній файл.');
      }

      let zip: JSZip;

      try {
        zip = await JSZip.loadAsync(await blob.arrayBuffer());
      } catch {
        throw new Error(
          'Відповідь сервера не вдалося прочитати як ZIP-архів.'
        );
      }

      const configFile = zip.file('config.json');

      if (!configFile) {
        throw new Error('В отриманому архіві немає config.json.');
      }

      let config: unknown;

      try {
        const text = await configFile.async('string');
        config = JSON.parse(text.replace(/^\uFEFF/, ''));
      } catch {
        throw new Error('Файл config.json має некоректний формат.');
      }

      if (
        typeof config !== 'object' ||
        config === null ||
        Array.isArray(config)
      ) {
        throw new Error(
          'Файл config.json повинен містити JSON-об’єкт.'
        );
      }

      // Джерело ID — конфіг саме цього архіву.
      const id = (config as Record<string, unknown>)['agentId'];

      if (typeof id !== 'string' || !id.trim()) {
        throw new Error(
          'У config.json відсутнє коректне поле agentId.'
        );
      }

      // Якщо заголовок доступний, перевіряємо відповідність.
      const headerId = response.headers.get('X-Agent-Id')?.trim();

      if (headerId && headerId !== id) {
        throw new Error(
          'ID у заголовку API та config.json не збігаються. Завантаження зупинено.'
        );
      }

      // Кодуємо значення agentId з config.json.
      const qr = await QRCode.toDataURL(id, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'M'
      });

      if (request.signal.aborted) return;

      const ready: AgentPackage = {
        id,
        qr,
        url: URL.createObjectURL(blob),
        filename: `RemoteMonitorAgent-${id}.zip`
      };

      this.result.set(ready);

      // Завантажуємо той самий архів, із якого прочитали ID.
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
            ? 'Не вдалося з’єднатися із сервером. Спробуйте ще раз.'
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