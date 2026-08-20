import { useCallback, useEffect, useState } from 'react';
import { api, type BookSummary } from '../api';

export function useBooks() {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const reload = useCallback(() => api.listBooks().then(setBooks), []);
  useEffect(() => { reload(); }, [reload]);
  return { books, reload };
}