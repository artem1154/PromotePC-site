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

  private readonly archivePath = 'agent/agent.zip';
  private readonly configPath = 'config.json';
  private readonly idField = 'groupId';

  private request?: AbortController;

  async downloadAgent(): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    const request = new AbortController();
    this.request = request;

    try {
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new Error(
          'Для створення ID відкрийте сайт через HTTPS або localhost.'
        );
      }

      const response = await fetch(
        new URL(this.archivePath, document.baseURI),
        {
          signal: request.signal,
          cache: 'no-cache'
        }
      );

      if (!response.ok) {
        throw new Error(
          'Файл агента поки недоступний. Спробуйте пізніше.'
        );
      }

      let zip: JSZip;

      try {
        zip = await JSZip.loadAsync(await response.arrayBuffer());
      } catch {
        throw new Error(
          'Не вдалося прочитати пакет агента. Зверніться до команди проєкту.'
        );
      }

      const configFile = zip.file(this.configPath);

      if (!configFile) {
        throw new Error(
          'У пакеті агента відсутній файл налаштувань.'
        );
      }

      let config: unknown;

      try {
        const text = await configFile.async('string');
        config = JSON.parse(text.replace(/^\uFEFF/, ''));
      } catch {
        throw new Error(
          'Файл налаштувань агента має некоректний формат.'
        );
      }

      if (
        typeof config !== 'object' ||
        config === null ||
        Array.isArray(config)
      ) {
        throw new Error(
          'Налаштування агента повинні бути JSON-об’єктом.'
        );
      }

      // Один ID використовується в конфігурації та QR-коді.
      const id = crypto.randomUUID();

      zip.file(
        this.configPath,
        JSON.stringify(
          {
            ...config,
            [this.idField]: id
          },
          null,
          2
        )
      );

      const qr = await QRCode.toDataURL(id, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'M'
      });

      const blob = await zip.generateAsync({ type: 'blob' });

      if (request.signal.aborted) return;

      const previous = this.result();

      const ready: AgentPackage = {
        id,
        qr,
        url: URL.createObjectURL(blob),
        filename: `RemotePC-${id}.zip`
      };

      this.result.set(ready);

      if (previous) {
        URL.revokeObjectURL(previous.url);
      }

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
            ? 'Не вдалося отримати файл. Перевірте з’єднання та спробуйте ще раз.'
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