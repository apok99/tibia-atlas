<?php

namespace App\Http\Middleware;

use App\Enums\Locale;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the active content locale for the request, in priority order:
 * 1. explicit ?lang= query param, 2. Accept-Language header, 3. app default.
 */
class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $supported = Locale::values();

        $candidate = $request->query('lang')
            ?? substr((string) $request->header('Accept-Language'), 0, 2);

        if (in_array($candidate, $supported, true)) {
            app()->setLocale($candidate);
        }

        return $next($request);
    }
}
