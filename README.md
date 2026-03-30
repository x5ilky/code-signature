# Code Signature Generator
Obtuse naming scheme for a thing that does what you think it does.

Default behaviour automatically appends signature onto source file, or replaces existing signature.

Options:
```bash
$ deno run -A main.ts
ARGUMENTS:
  <file name> (required)
    Target file
  --ascii-map <string> (optional)
    characters to be used for ascii
  --grayscale-unicode (optional)
    use grayscale unicode charset <▁▂▃▄▅▆▇█>
  --small-ascii (optional)
    use small ascii charset <..,:-=+*#%@>
  --footer <string> (optional)
    message below image
  -e (optional)
    include edit time below signature
  -h <number> (optional)
    height of image
  -w <number> (optional)
    width of image
  -O (optional)
    output signature to stdout
```

