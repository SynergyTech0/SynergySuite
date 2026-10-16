import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "./pagination";


export default function paginationCombined({currentPage, totalPages, setCurrentPage, maxVisiblePages}: {currentPage: number, totalPages: number, setCurrentPage: (page: number) => void, maxVisiblePages?: number}) {
    const DEFAULTMAXPAGES = 3;

    const visiblePages = Math.min(maxVisiblePages ?? totalPages, DEFAULTMAXPAGES);
    const startPage = Math.max(1, Math.min(totalPages - visiblePages + 1, currentPage - Math.floor(visiblePages / 2)));
    const endPage = Math.min(totalPages, startPage + visiblePages - 1);

    // Don't render if there's only one page or none
    if (totalPages <= 1) {
        return null;
    }

    return (
        <Pagination>
            <PaginationContent>
                <PaginationItem>
                    <PaginationPrevious
                        onClick={(e) => {
                            e.preventDefault();
                            if (currentPage <= 1) return;
                            setCurrentPage(Math.max(1, currentPage - 1));
                        }}
                    />
                </PaginationItem>

                {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map((page) => (
                    <PaginationItem key={page+"pageChoice"}>
                        <button
                            onClick={() => setCurrentPage(page)}
                            className={"transition hover:bg-gray-100 rounded-md h-9 w-9 flex items-center justify-center" + (page === currentPage ? " font-bold" : "")}
                        >
                            {page}
                        </button>
                    </PaginationItem>
                ))}

                <PaginationItem>
                    <PaginationNext
                        onClick={(e) => {
                            e.preventDefault();
                            if (currentPage >= totalPages) return;
                            setCurrentPage(Math.min(totalPages, currentPage + 1));
                        }}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}