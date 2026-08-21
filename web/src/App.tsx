import { useState } from 'react';
import { StepHeader } from './components/StepHeader';
import { Step1Start } from './steps/Step1Start';
import { Step2Book } from './steps/Step2Book';
import { Step3Diff } from './steps/Step3Diff';
import { Step4Select } from './steps/Step4Select';
import { Step5Cards } from './steps/Step5Cards';
import { Step6Export } from './steps/Step6Export';
import { useSession } from './hooks/useSession';
import type { BookInfo } from './api';
import './styles/base.css';
import './App.css';

export default function App() {
  const {
    session, conflict, accept, refresh,
    goTo, pickBook, saveDecisions, applyDecisions, saveDeselected, runExport, undoExport, reset,
  } = useSession();
  const [book, setBook] = useState<BookInfo | null>(null);

  if (!session) return <div className="app muted">Загружаю…</div>;

  const step = session.step;

  return (
    <div className="app">
      <StepHeader current={step} />
      {conflict && <p className="banner">{conflict}</p>}

      {step === 1 && (
        <Step1Start
          onUploaded={(b, s) => { setBook(b); accept(s); goTo(2); }}
          onPick={(hash) => { void pickBook(hash); }}
        />
      )}

      {step === 2 && book && <Step2Book book={book} onNext={() => goTo(3)} />}
      {step === 2 && !book && (
        <p className="muted">
          Информация о книге не сохранилась после перезагрузки.{' '}
          <button className="linklike" onClick={() => goTo(3)}>Перейти к словарю</button>
        </p>
      )}

      {step === 3 && session.bookHash && (
        <Step3Diff bookHash={session.bookHash} onApplied={() => goTo(4)} onBack={() => reset()} />
      )}

      {step === 4 && session.bookHash && (
        <Step4Select
          bookHash={session.bookHash}
          initial={session.decisions}
          onSave={saveDecisions}
          onApply={applyDecisions}
          onBack={() => reset()}
        />
      )}

      {(step === 3 || step === 4) && !session.bookHash && (
        <div className="stack">
          <p className="muted">Книга не выбрана — сессия начата в другой вкладке или сброшена.</p>
          <button className="linklike" onClick={() => goTo(1)}>К списку книг</button>
        </div>
      )}

      {step === 5 && (
        <Step5Cards
          job={session.job}
          onRefresh={refresh}
          onDeselect={saveDeselected}
          onNext={() => goTo(6)}
          onBack={() => reset()}
        />
      )}

      {step >= 6 && (
        <Step6Export
          onRun={runExport}
          onUndo={undoExport}
          onRestart={() => reset()}
        />
      )}
    </div>
  );
}
