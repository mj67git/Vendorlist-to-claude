import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  onPageChange,
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-5 border-t border-border text-muted-foreground text-xs font-medium">
      <div className="order-2 sm:order-1 text-muted-foreground text-right">
        نمایش <span className="font-bold text-foreground font-mono">{startIndex + 1}</span> تا{" "}
        <span className="font-bold text-foreground font-mono">{Math.min(endIndex, totalItems)}</span> از{" "}
        <span className="font-bold text-foreground font-mono">{totalItems}</span> مورد
      </div>
      <div className="flex items-center gap-1.5 order-1 sm:order-2" dir="ltr">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={currentPage === 1}
          aria-label="صفحه قبل"
          onClick={() => onPageChange(currentPage - 1)}
          className="h-8 w-8 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="صفحه قبل"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
          const isNear = Math.abs(p - currentPage) <= 1 || p === 1 || p === totalPages;
          if (!isNear) {
            if (p === 2 || p === totalPages - 1) {
              return <span key={p} className="px-1 text-muted-foreground/60 font-mono select-none">...</span>;
            }
            return null;
          }
          return (
            <Button
              key={p}
              type="button"
              variant={currentPage === p ? "default" : "outline"}
              size="icon"
              aria-label={`صفحه ${p}`}
              aria-current={currentPage === p ? 'page' : undefined}
              onClick={() => onPageChange(p)}
              className="h-8 w-8 rounded-xl font-bold font-mono cursor-pointer text-xs"
            >
              {p}
            </Button>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={currentPage === totalPages}
          aria-label="صفحه بعد"
          onClick={() => onPageChange(currentPage + 1)}
          className="h-8 w-8 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="صفحه بعد"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
