import { useRef, useState, type CSSProperties } from 'react';
import { Button } from '../components/Button';
import { useBooks } from '../hooks/useBooks';
import { api, type BookInfo, type Session } from '../api';
import './Step1Start.css';

const n = (v: number) => v.toLocaleString('ru-RU');

export function Step1Start({
                             onUploaded, onPick,
                           }: {
  onUploaded: (book: BookInfo, session: Session) => void;
  onPick: (hash: string) => void;
}) {
  const { books } = useBooks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { book, session } = await api.uploadBook(file);
      onUploaded(book, session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1 className="start__title">Что разбираем</h1>

      <div
        className={`drop${over ? ' drop--over' : ''}${busy ? ' drop--busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
      >
        <p className="drop__lead">{busy ? 'Разбираю книгу…' : 'Перетащи файл книги сюда'}</p>
        {/* Только проверенные форматы. Остальное сервер тоже разберёт —
            officeparser знает docx, rtf, odt, md, html и pdf, — но обещать
            то, чего не гоняли на настоящих файлах, не стоит. */}
        <p className="muted drop__formats mono">epub · txt · srt</p>
        <Button onClick={() => input.current?.click()} disabled={busy}>Выбрать файл</Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".epub,.txt,.srt"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </div>

      {error && <p className="error">{error}</p>}

      {books && books.length > 0 && (
        <section className="stack">
          <h2 className="start__sub">Или добери слова из разобранной книги</h2>
          <ul className="booklist">
            {books.map((b) => (
              <li key={b.hash}>
                {/*
                  Зелёная заливка — доля выгруженного от взятого в словарь.
                  Число само по себе не показывает, сколько ещё идти;
                  полоса показывает это, не занимая ни строки.
                */}
                <button
                  className="bookrow"
                  onClick={() => onPick(b.hash)}
                  style={{ '--done-part': `${b.inDictionary ? (b.exported / b.inDictionary) * 100 : 0}%` } as CSSProperties}
                >
                  <span className="bookrow__title">{b.title ?? b.sourceName}</span>
                  <span className="muted bookrow__meta mono">
                    в словаре {n(b.inDictionary)} · в Noji {n(b.exported)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {books && books.length === 0 && (
        <p className="muted">Книг пока нет. Загрузи первую — дальше словарь будет копиться сам.</p>
      )}
    </div>
  );
}