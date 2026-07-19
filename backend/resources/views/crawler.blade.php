<!doctype html>
<html lang="{{ $lang }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ $title }}</title>
  <meta name="description" content="{{ $description }}">
  @if(!empty($canonical))
  @php
    // The clean URL is the Spanish (default) variant; ?lang=en is English.
    // Each variant is SELF-canonical, matching frontend/src/lib/seo.tsx.
    $enUrl = $canonical.'?lang=en';
    $selfCanonical = $lang === 'en' ? $enUrl : $canonical;
  @endphp
  <link rel="canonical" href="{{ $selfCanonical }}">
  <link rel="alternate" hreflang="es" href="{{ $canonical }}">
  <link rel="alternate" hreflang="en" href="{{ $enUrl }}">
  <link rel="alternate" hreflang="x-default" href="{{ $canonical }}">
  @endif
  @if(!empty($noindex))<meta name="robots" content="noindex, follow">@endif

  <meta property="og:site_name" content="Tibia Atlas">
  <meta property="og:title" content="{{ $ogTitle ?? $title }}">
  <meta property="og:description" content="{{ $description }}">
  <meta property="og:type" content="{{ $ogType ?? 'website' }}">
  @if(!empty($canonical))<meta property="og:url" content="{{ $selfCanonical }}">@endif
  <meta property="og:image" content="{{ $image }}">
  <meta property="og:locale" content="{{ $lang === 'es' ? 'es_ES' : 'en_US' }}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ $ogTitle ?? $title }}">
  <meta name="twitter:description" content="{{ $description }}">
  <meta name="twitter:image" content="{{ $image }}">

  @foreach(($jsonLd ?? []) as $block)
  {{-- JSON_HEX_TAG: a literal </script> in wiki-imported lore must not break out of the block. --}}
  <script type="application/ld+json">{!! json_encode($block, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) !!}</script>
  @endforeach
</head>
<body>
  <header>
    <a href="{{ $site }}"><strong>Tibia Atlas</strong></a> — {{ $lang === 'es' ? 'El atlas viviente del mundo de Tibia' : 'The living atlas of the Tibian world' }}
  </header>
  <main>
    {!! $body !!}
  </main>
  <footer>
    <p>Tibia Atlas — {{ $lang === 'es' ? 'Proyecto de fans, no afiliado a CipSoft.' : 'Fan project, not affiliated with CipSoft.' }}</p>
  </footer>
</body>
</html>
