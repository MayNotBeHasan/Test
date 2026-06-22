with open("text1.txt", "r", encoding="utf-8") as f:
    text = f.read()

count = text.count("Rule ID:")
print("Total Rule IDs =", count)