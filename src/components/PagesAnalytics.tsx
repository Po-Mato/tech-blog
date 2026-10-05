'use client';
import { useEffect } from 'react';
import { startPagesAnalytics } from '../lib/pages-analytics';
export default function PagesAnalytics() {
  useEffect(() => { startPagesAnalytics(); }, []);
  return null;
}
