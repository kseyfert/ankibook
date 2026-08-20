import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Choice, type Option } from '../components/Choice';
import { ZipfScale } from '../components/ZipfScale';
import { api, type CandidateWord, type Candidates, type Decision } from '../api';
import './Step4Select.css';

const n = (v: number) => v.toLocaleString('ru-RU');

/** Порядок соответствует клавишам CLI: s, r, k, x. */
const OPTIONS: Array<Option<Decision>> = [
  { value: 'speak', label: 'Говорить', tone: 'speak' },
  { value: 'read', label: 'Узнавать', tone: 'read' },
  { value: 'known', label: 'Знаю' },
  { value: 'rejected', label: 'Не нужно' },
];

const DECK_TITLE = {
  speak: 'Активный словарь',
  read: 'Только узнавание',
} as const;

const DECK_NOTE = {
  speak: 'Предложение с пропуском и русской подсказкой, ответ произносится вслух.',
  read: 'Слово → перевод. Редкая и книжная лексика, где хватает узнавания.',
} as const;

/** Пауза перед автосохранением. Решения кликают очередями по несколько
 *  штук — сохранять каждое означало бы гонку версий на ровном месте. */
const SAVE_DELAY = 700;

function Word({ w, known, value, onChange }: {
  w: CandidateWord;
  known: number;
  value: Decision;
  onChange: (v: Decision) => void;
}) {
  return (
    <li className={`cand${value === 'known' || value === 'rejected' ? ' cand--out' : ''}`}>
      <div className="cand__head">
        <span className="cand__lemma">{w.lemma}</span>
        <span className="muted cand__pos">{w.posLabel}</span>
        <span className="mono cand__nums">
          ×{w.countInBook}
          {w.bookCount > 1 && <span className="muted"> · {w.bookCount} кн.</span>}
        </span>
        <ZipfScale zipf={w.zipf} known={known} />
      </div>

      {w.checkSense && w.overrepresentation !== null && (
        <p className="cand__warn">
          встречается в {n(w.overrepresentation)}× чаще ожидаемого — проверь значение по контекстам
        </p>
      )}

      {w.contexts.length > 0 && (
        <ul className="cand__ctx">
          {w.contexts.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}

      <div className="cand__foot">
        <Choice options={OPTIONS} value={value} onChange={onChange} name={`Решение по слову ${w.lemma}`} />
        <span className="muted cand__reason">{w.reason}</span>
      </div>
    </li>
  );
}

export function Step4Select({
                              bookHash, initial, onSave, onApply, onBack,
                            }: {
  bookHash: string;
  /** решения, сохранённые в сессии до перезагрузки */
  initial: Record<string, Decision>;
  onSave: (decisions: Record<string, Decision>) => Promise<unknown>;
  onApply: () => Promise<unknown>;
  onBack: () => void;
}) {
  const [data, setData] = useState<Candidates | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initial);
  /** null — «сколько решит сервер». Меняется только кнопкой «показать ещё»:
   *  положи сюда лимиты из ответа — и запрос уйдёт повторно сам с собой. */
  const [want, setWant] = useState<{ speak: number; read: number } | null>(null);
  const limits = useRef<{ speak: number; read: number } | null>(null);
  /** Первая порция задаёт шаг «показать ещё». Иначе прибавка считалась бы
   *  от текущего лимита и каждый клик удваивал бы выдачу. */
  const chunk = useRef<{ speak: number; read: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Решения из сессии читаются один раз: дальше источник истины — экран,
   *  иначе ответ автосохранения возвращал бы состояние назад. */
  const saved = useRef(initial);
  const dirty = useRef(false);

  useEffect(() => {
    const q = want ?? { speak: 0, read: 0 };
    api.getCandidates(bookHash, q.speak, q.read)
      .then((d) => {
        setData(d);
        limits.current = d.limits;
        chunk.current ??= d.limits;
        // Предложение колоды — значение по умолчанию, как Enter в CLI.
        // Уже принятые решения оно не перебивает.
        setDecisions((prev) => {
          const next = { ...prev };
          for (const w of [...d.words.speak, ...d.words.read]) {
            if (next[w.lemma] === undefined) {
              next[w.lemma] = saved.current[w.lemma] ?? w.suggested;
            }
          }
          return next;
        });
      })
      .catch((e) => setError((e as Error).message));
  }, [bookHash, want]);

  /** Функция сохранения держится в ref, чтобы таймер зависел только от
   *  самих решений. Иначе смена идентичности колбэка перезапускала бы
   *  отсчёт и сохранение уходило бы по кругу, ничего не меняя. */
  const save = useRef(onSave);
  useEffect(() => { save.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => { void save.current(decisions); }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [decisions]);

  const counts = useMemo(() => {
    const c: Record<Decision, number> = { speak: 0, read: 0, known: 0, rejected: 0 };
    for (const w of [...(data?.words.speak ?? []), ...(data?.words.read ?? [])]) {
      const d = decisions[w.lemma];
      if (d) c[d]++;
    }
    return c;
  }, [data, decisions]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Считаю кандидатов…</p>;

  const shown = data.words.speak.length + data.words.read.length;

  const set = (lemma: string, v: Decision) => {
    dirty.current = true;
    setDecisions((prev) => ({ ...prev, [lemma]: v }));
  };

  const setDeck = (words: CandidateWord[], v: Decision) => {
    dirty.current = true;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const w of words) next[w.lemma] = v;
      return next;
    });
  };

  async function apply() {
    setBusy(true);
    try {
      // Сохраняем черновик до применения: применение читает решения
      // из сессии, а отложенное автосохранение могло ещё не сработать.
      await onSave(decisions);
      await onApply();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const group = (deck: 'speak' | 'read', words: CandidateWord[]) =>
    words.length > 0 && (
      <section className="stack" key={deck}>
        <div className="sel__group">
          <h2 className={`sel__deck sel__deck--${deck}`}>{DECK_TITLE[deck]}</h2>
          <Button variant="quiet" onClick={() => setDeck(words, deck === 'speak' ? 'read' : 'speak')}>
            Все в «{deck === 'speak' ? 'Узнавать' : 'Говорить'}»
          </Button>
          <Button variant="quiet" onClick={() => setDeck(words, 'rejected')}>Все не нужны</Button>
        </div>
        <p className="muted sel__note">{DECK_NOTE[deck]}</p>
        <ul className="cands">
          {words.map((w) => (
            <Word key={w.lemma} w={w} known={data.knownZipf}
                  value={decisions[w.lemma] ?? w.suggested}
                  onChange={(v) => set(w.lemma, v)} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="stack">
      <h1 className="sel__title">Что учить</h1>

      {shown === 0 ? (
        <>
          <p className="muted">
            Кандидатов больше нет: все слова этой книги уже разобраны или
            не проходят порог знания.
          </p>
          <div className="row">
            <Button variant="quiet" onClick={onBack}>К списку книг</Button>
          </div>
        </>
      ) : (
        <>
          <dl className="facts">
            <div><dt>Показано</dt><dd className="mono">{n(shown)}</dd></div>
            <div><dt>Говорить</dt><dd className="mono">{n(counts.speak)}</dd></div>
            <div><dt>Узнавать</dt><dd className="mono">{n(counts.read)}</dd></div>
            <div><dt>Отложено</dt><dd className="mono">{n(counts.known + counts.rejected)}</dd></div>
          </dl>

          <p className="muted sel__hint">
            Колода проставлена по умолчанию — правь только там, где не согласен.
            «Знаю» и «Не нужно» — тупики: слово больше не предложится, но
            «знаю» ещё пригодится, чтобы со временем поднять порог знания.
          </p>

          {group('speak', data.words.speak)}
          {group('read', data.words.read)}

          {data.remaining > 0 && (
            <div className="stack">
              <p className="muted sel__rest">
                Ещё {n(data.remaining)} слов этой книги ждут отбора. Их можно
                добрать следующим проходом — словарь всё помнит.
              </p>
              <div className="row">
                <Button onClick={() => setWant({
                  speak: (limits.current?.speak ?? 0) + (chunk.current?.speak ?? 30),
                  read: (limits.current?.read ?? 0) + (chunk.current?.read ?? 15),
                })}>
                  Показать ещё
                </Button>
              </div>
            </div>
          )}

          <div className="row sel__actions">
            <Button variant="primary" onClick={apply} disabled={busy}>
              {busy ? 'Применяю…' : `Дальше — карточки (${n(counts.speak + counts.read)})`}
            </Button>
            <Button variant="quiet" onClick={onBack}>К списку книг</Button>
          </div>
        </>
      )}
    </div>
  );
}
