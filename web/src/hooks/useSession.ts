import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ConflictError, type Decision, type Session } from '../api';

const KEY = 'vocabmine.version';

/**
 * Сессия сервера плюс защита от расхождения версий.
 *
 * Фронт хранит в localStorage только номер версии. Не совпал — сервер
 * возвращает 409 со своей сессией, мы показываем ошибку и заменяем
 * состояние серверным. Одна сессия на пользователя, блокировки не нужны.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  /**
   * Версия живёт в ref, а не только в состоянии.
   *
   * Проверка отвечает на вопрос «менял ли кто-то сессию МИМО нас», и ответ
   * должен строиться на последнем известном НАМ значении. Замыкание из
   * состояния для этого не годится: два вызова подряд (сохранить черновик,
   * затем применить) выполняются в одном рендере, второй уходил бы с
   * версией до первого — и сервер честно отвечал 409 на пустом месте.
   */
  const version = useRef(0);

  const accept = useCallback((s: Session) => {
    version.current = s.version;
    setSession(s);
    localStorage.setItem(KEY, String(s.version));
  }, []);

  useEffect(() => { api.getSession().then(accept); }, [accept]);

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        setConflict(null);
        return await fn();
      } catch (e) {
        if (e instanceof ConflictError) {
          accept(e.session);
          setConflict('Сессия изменилась в другой вкладке. Показано актуальное состояние.');
          return null;
        }
        throw e;
      }
    },
    [accept],
  );

  const goTo = useCallback(
    (step: number) => guard(() => api.setStep(step, version.current).then(accept)),
    [guard, accept],
  );

  const pickBook = useCallback(
    (hash: string) => guard(() => api.selectBook(hash, version.current).then(accept)),
    [guard, accept],
  );

  const saveDecisions = useCallback(
    (decisions: Record<string, Decision>) =>
      guard(() => api.saveDecisions(decisions, version.current).then(accept)),
    [guard, accept],
  );

  const applyDecisions = useCallback(
    () => guard(() => api.applyDecisions(version.current).then((r) => { accept(r.session); return r; })),
    [guard, accept],
  );

  const reset = useCallback(() => api.resetSession().then(accept), [accept]);

  return { session, conflict, accept, guard, goTo, pickBook, saveDecisions, applyDecisions, reset };
}
