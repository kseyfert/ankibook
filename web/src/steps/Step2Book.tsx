import { Button } from '../components/Button';
import type { BookInfo } from '../api';
import './Step2Book.css';

const n = (v: number) => v.toLocaleString('ru-RU');

export function Step2Book({ book, onNext }: { book: BookInfo; onNext: () => void }) {
  return (
    <div className="stack">
      <div>
        <h1 className="book__title">{book.title ?? book.sourceName}</h1>
        {book.author && <p className="muted book__author">{book.author}</p>}
      </div>

      <dl className="facts">
        <div><dt>Слов</dt><dd className="mono">{n(book.wordCount)}</dd></div>
        <div><dt>Знаков</dt><dd className="mono">{n(book.charCount)}</dd></div>
        <div><dt>Уникальных лемм</dt><dd className="mono">{n(book.lemmaCount)}</dd></div>
        <div><dt>Слов с примерами</dt><dd className="mono">{n(book.contextCount)}</dd></div>
      </dl>

      <p className="muted book__note">
        Разобрано и сохранено. Дальше посмотрим, что из этого добавится в словарь.
      </p>

      <div className="row">
        <Button variant="primary" onClick={onNext}>Дальше — словарь</Button>
      </div>
    </div>
  );
}