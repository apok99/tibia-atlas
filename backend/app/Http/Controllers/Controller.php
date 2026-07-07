<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

abstract class Controller
{
    /** Read an integer query param clamped to the [$min, $max] range. */
    protected function clamp(Request $request, string $key, int $default, int $min, int $max): int
    {
        return min(max($request->integer($key, $default), $min), $max);
    }
}
