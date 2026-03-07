Start cmux-hub dev server in background.

Run the following command in background:

```
$ARGUMENTS
```

If $ARGUMENTS is empty, run this default:

```
bun --hot src/cli.ts --actions - <<'EOF'
[
  {
    "label": "Commit",
    "type": "paste-and-enter",
    "command": "/commit"
  },
  {
    "label": "Commit & Push",
    "type": "paste-and-enter",
    "command": "/commit-push"
  },
  {
    "label": "Create PR",
    "type": "paste-and-enter",
    "command": "/create-pr"
  }
]
EOF
```
