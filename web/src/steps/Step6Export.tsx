import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { api, type ExportFile, type ExportResult, type ExportState } from '../api';
import './Step6Export.css';

const n = (v: number) => v.toLocaleString('ru-RU');
const cards = (v: number) => `${n(v)} ${v % 10 === 1 && v % 100 !== 11 ? 'карточка' : 'карточек'}`;

/** Имя файла без пути: путь целиком в заголовке панели не нужен. */
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function Panel({ file }: { file: ExportFile }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(file.csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /**
   * Скачивание собирается на месте из уже показанного текста.
   *
   * Ссылка на файл сервера не годится: он лежит в user/, которую vite
   * наружу не отдаёт, а отдавать её значит открыть весь каталог данных.
   */
  const download = () => {
    const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = basename(file.file);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <span className={`mono panel__deck panel__deck--${file.deck}`}>{file.deck}</span>
        <span className="mono panel__name">{basename(file.file)}</span>
        <span className="muted panel__count">{cards(file.count)}</span>
        <IconButton icon="copy" label={copied ? 'Скопировано' : 'Скопировать'} onClick={() => void copy()} />
        <IconButton icon="download" label="Скачать файл" onClick={download} />
      </header>
      {/* readonly textarea, а не <pre>: выделяется по Cmd+A внутри себя
          и не тащит за собой остальную страницу. */}
      <textarea className="mono panel__text" readOnly value={file.csv}
                onFocus={(e) => e.currentTarget.select()} />
    </section>
  );
}

export function Step6Export({ onRun, onUndo, onRestart }: {
  onRun: () => Promise<ExportResult | null>;
  onUndo: () => Promise<unknown>;
  onRestart: () => void;
}) {
  const [state, setState] = useState<ExportState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => api.exportState().then(setState), []);
  useEffect(() => { reload().catch((e) => setError((e as Error).message)); }, [reload]);

  /**
   * Выгрузка идёт сама при заходе на шаг.
   *
   * Признак «уже прошла» — записанные файлы в сессии, они переживают
   * перезагрузку вкладки. Поэтому повторно она не запускается и вторых
   * файлов за тот же проход не появляется.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !state) return;
    if (state.files.length > 0 || state.pending === 0) return;
    started.current = true;
    setBusy(true);
    void onRun()
      .then(() => reload())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  });

  async function undo() {
    setBusy(true);
    try {
      await onUndo();
      onRestart();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!state) return <p className="muted">Считаю…</p>;

  if (busy && !state.files.length) {
    return (
      <div className="stack">
        <h1 className="exp__title">Экспорт</h1>
        <p className="muted">Пишу файлы…</p>
      </div>
    );
  }

  if (!state.files.length) {
    return (
      <div className="stack">
        <h1 className="exp__title">Экспорт</h1>
        <p className="muted">
          Выгружать нечего: карточки либо уже уехали, либо сняты галочкой,
          либо не прошли проверки.
        </p>
        <div className="row">
          <Button variant="quiet" onClick={onRestart}>На главную</Button>
        </div>
      </div>
    );
  }

  const total = state.files.reduce((sum, f) => sum + f.count, 0);

  return (
    <div className="stack">
      <h1 className="exp__title">Выгружено</h1>

      <p className="exp__lead">
        {cards(total)} записаны в <span className="mono">user/exports/</span>, слова
        помечены в словаре выгруженными. Скопируй текст или скачай файлы
        и загрузи в Noji.
      </p>

      {state.files.map((f) => <Panel key={f.file} file={f} />)}

      <p className="muted exp__note">
        Если что-то не так — отмени. Файлы удалятся, словам вернётся статус
        «ждёт выгрузки», а карточки останутся: отменяется выгрузка, а не работа
        до неё. После отмены проход начинается заново с первого шага.
      </p>

      <div className="row exp__actions">
        <Button variant="primary" onClick={onRestart} disabled={busy}>На главную</Button>
        <Button variant="quiet" onClick={() => void undo()} disabled={busy}>
          {busy ? 'Отменяю…' : 'Отменить выгрузку'}
        </Button>
      </div>

      {state.history.length > state.files.length && (
        <div className="stack">
          <h2 className="exp__sub">Прошлые выгрузки</h2>
          <ul className="exp__files">
            {state.history
              .filter((h) => !state.files.some((f) => f.file === h.file))
              .map((f) => (
                <li key={f.file}>
                  <span className={`mono panel__deck panel__deck--${f.deck}`}>{f.deck}</span>
                  <span className="mono exp__path">{f.file}</span>
                  <span className="muted exp__count">{f.date} · {cards(f.count)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
