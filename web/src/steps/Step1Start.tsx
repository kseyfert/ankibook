import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import { useBooks } from '../hooks/useBooks';
import { api, type BookInfo, type Session } from '../api';
import './Step1Start.css';

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
        <p className="muted drop__formats mono">epub · txt · docx · rtf · odt · md · html · pdf</p>
        <Button onClick={() => input.current?.click()} disabled={busy}>Выбрать файл</Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".epub,.txt,.docx,.rtf,.odt,.md,.html,.pdf"
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
                <button className="bookrow" onClick={() => onPick(b.hash)}>
                  <span className="bookrow__title">{b.title ?? b.sourceName}</span>
                  <span className="muted bookrow__meta mono">
                    {b.lemmaCount} лемм · {b.candidatesLeft} не отобрано
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